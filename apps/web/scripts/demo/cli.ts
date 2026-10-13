/**
 * T-705 demo kit CLI (docs/archive/DEMO.md §4). Real mode only; mock mode needs no seed.
 *
 *   pnpm --filter @hakit/web demo seed [--owner <github-login>]
 *   … demo reset | demo swap | demo stall <HK-number>
 *
 * D1 can't be reached by URL from Node, so this runs against the LOCAL D1 that `pnpm dev` uses
 * (apps/web/.wrangler state, via wrangler's platform proxy). Apply migrations to it first with
 * `wrangler d1 migrations apply hakit --local`. A deployed demo database is not seeded from here.
 */
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { createDb } from '@hakit/db';
import { resetDemo, seedDemo, stallTask, swapTeam } from './seed';

const [command, ...args] = process.argv.slice(2);
const usage = 'usage: demo <seed [--owner login] | reset | swap | stall <n>> (local D1 only)';
if (!command || !['seed', 'reset', 'swap', 'stall'].includes(command)) throw new Error(usage);

const root = fileURLToPath(new URL('../../', import.meta.url));
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: `${root}wrangler.jsonc`,
  persist: { path: `${root}.wrangler/state/v3` },
});
const { db } = createDb(proxy.env.DB);
const now = new Date();
try {
  if (command === 'seed') {
    const owner = args[args.indexOf('--owner') + 1];
    const out = await seedDemo(db, { now, ownerLogin: args.includes('--owner') ? owner : undefined });
    console.log(
      `demo workspace ${out.workspaceId} project ${out.projectId}; deadline ${out.deadlineAt.toISOString()}`,
    );
  } else if (command === 'reset') {
    await resetDemo(db);
    console.log('demo workspace removed');
  } else if (command === 'swap') {
    console.log(`team is now: ${await swapTeam(db, now)}`);
  } else {
    const n = Number(String(args[0] ?? '').replace(/^hk-/i, ''));
    if (!Number.isInteger(n) || n < 1) throw new Error(usage);
    const { quietHours } = await stallTask(db, n, now);
    console.log(
      `HK-${n} in progress, started ${quietHours.toFixed(2)}h ago; next recs.evaluate (≤2 min) flags it`,
    );
  }
} finally {
  await proxy.dispose();
}
