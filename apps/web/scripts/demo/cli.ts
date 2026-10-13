/**
 * T-705 demo kit CLI (docs/archive/DEMO.md §4). Real mode only; mock mode needs no seed.
 *
 *   DEMO_DATABASE_URL=postgres://…fork… pnpm --filter @hakit/web demo seed [--owner <github-login>]
 *   … demo reset | demo swap | demo stall <HK-number>
 *
 * Safety: it reads DEMO_DATABASE_URL only (never DATABASE_URL), refuses to run when the two are
 * equal, and requires DEMO_FORK_CONFIRM=yes. Point it at a Tiger fork, never the shared dev DB.
 */
import { createDb } from '@hakit/db';
import { resetDemo, seedDemo, stallTask, swapTeam } from './seed';

const [command, ...args] = process.argv.slice(2);
const url = process.env.DEMO_DATABASE_URL;
const usage =
  'usage: demo <seed [--owner login] | reset | swap | stall <n>> (needs DEMO_DATABASE_URL, DEMO_FORK_CONFIRM=yes)';
if (!command || !['seed', 'reset', 'swap', 'stall'].includes(command)) throw new Error(usage);
if (!url) throw new Error('Set DEMO_DATABASE_URL to the Tiger fork used for the demo');
if (process.env.DATABASE_URL && process.env.DATABASE_URL === url)
  throw new Error('DEMO_DATABASE_URL equals DATABASE_URL: refusing to touch the shared dev database');
if (process.env.DEMO_FORK_CONFIRM !== 'yes')
  throw new Error('Set DEMO_FORK_CONFIRM=yes to confirm DEMO_DATABASE_URL is a disposable fork');

const { db, ready, close } = createDb(url);
await ready;
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
  await close();
}
