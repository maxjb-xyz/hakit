/** Liveness + deep health (T-008). Owner: PL. */
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../lib/context';
import { githubAppJwt } from '../lib/github-app-jwt';

const TIMEOUT_MS = 5000;

/** Fetch that throws on non-2xx with only the status (bodies may echo request data). */
async function probe(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export const health = new Hono<AppEnv>();

health.get('/health', (c) => c.json({ ok: true, mocks: c.var.mocks, requestId: c.var.requestId }));

health.get('/health/deep', async (c) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      checks[name] = { ok: true, ...(typeof r === 'string' ? { detail: r } : {}) };
    } catch (e) {
      checks[name] = { ok: false, detail: String(e) };
    }
  };
  await run('durable_object', async () => {
    const stub = c.env.PROJECT_ROOM.get(c.env.PROJECT_ROOM.idFromName('health'));
    return `seq ${await stub.broadcast({ type: 'board.changed', data: { reason: 'health' } })}`;
  });
  if (!c.var.mocks) {
    await run('database', async () => {
      const r = await c.var
        .db()
        .execute(
          sql`select time_bucket('15 minutes', now()) as b, extversion from pg_extension where extname = 'timescaledb'`,
        );
      return JSON.stringify(r.rows[0]);
    });
    await run('queue', () =>
      c.env.JOBS.send({
        type: 'recs.evaluate',
        projectId: '00000000-0000-4000-8000-000000000000',
        reason: 'cron',
      }),
    );
    const env = c.env;
    await run('github_app', async () => {
      if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY)
        throw new Error('GITHUB_APP_ID/PRIVATE_KEY not set');
      const jwt = await githubAppJwt(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        Math.floor(Date.now() / 1000),
      );
      const res = await probe('https://api.github.com/app', {
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'hakit',
        },
      });
      return `slug ${((await res.json()) as { slug?: string }).slug}`;
    });
    await run('gemini', async () => {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      // Metadata lookup: proves key + model without spending tokens. Key goes in a header, never the URL.
      await probe(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL_FAST}`, {
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
      });
      return env.GEMINI_MODEL_FAST;
    });
    await run('hf_embed', async () => {
      if (!env.HF_TOKEN) throw new Error('HF_TOKEN not set');
      const res = await probe(
        `https://router.huggingface.co/hf-inference/models/${env.EMBED_MODEL}/pipeline/feature-extraction`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${env.HF_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ inputs: ['ping'] }),
        },
      );
      const vec = ((await res.json()) as number[][])[0];
      if (vec?.length !== Number(env.EMBED_DIM))
        throw new Error(`dim ${vec?.length} != EMBED_DIM ${env.EMBED_DIM}`);
      return `dim ${vec.length}`;
    });
  }
  const ok = Object.values(checks).every((x) => x.ok);
  return c.json({ ok, mocks: c.var.mocks, checks }, ok ? 200 : 503);
});
