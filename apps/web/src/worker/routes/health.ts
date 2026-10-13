/** Liveness + deep health (T-008). Owner: PL. */
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../lib/context';
import { githubAppJwt } from '../lib/github-app-jwt';
import { bindingRun, GEMINI_DEFAULT_FAST } from '../services/ai';
import { hfEmbeddings, workersAiEmbeddings } from '../services/embeddings';

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
    await run('workers_ai', async () => {
      if (!env.AI) throw new Error('AI binding not configured');
      // One short embedding proves the binding and account allowance; generation would spend far more.
      const [vec] = await workersAiEmbeddings({
        run: bindingRun(env.AI),
        model: env.EMBED_MODEL,
        dim: Number(env.EMBED_DIM),
        timeoutMs: TIMEOUT_MS,
      }).embed(['Health check'], 'document');
      return `${env.AI_MODEL_PLAN}, embeddings dim ${vec!.length}`;
    });
    // Optional fallbacks: checked only when configured, so a Workers-AI-only deployment is healthy.
    if (env.GEMINI_API_KEY)
      await run('gemini', async () => {
        const model = env.GEMINI_MODEL_FAST ?? GEMINI_DEFAULT_FAST;
        // Metadata lookup: proves key + model without spending tokens. Key goes in a header, never the URL.
        await probe(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
          headers: { 'x-goog-api-key': env.GEMINI_API_KEY! },
        });
        return model;
      });
    if (env.HF_TOKEN)
      await run('hf_embed', async () => {
        const [vec] = await hfEmbeddings({
          token: env.HF_TOKEN!,
          model: env.EMBED_MODEL,
          dim: Number(env.EMBED_DIM),
          timeoutMs: TIMEOUT_MS,
        }).embed(['Health check'], 'document');
        return `dim ${vec!.length}`;
      });
  }
  const ok = Object.values(checks).every((x) => x.ok);
  return c.json({ ok, mocks: c.var.mocks, checks }, ok ? 200 : 503);
});
