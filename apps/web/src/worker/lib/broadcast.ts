import type { WsPayload } from '@hakit/contracts';
import type { Env } from '../env';

/** Fan out to a project's dashboards. Call only after the DB transaction committed. */
export async function broadcast(env: Env, projectId: string, payload: WsPayload): Promise<void> {
  const stub = env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(projectId));
  await stub.broadcast(payload);
}
