import type { WsPayload } from '@hakit/contracts';
import type { Env } from '../env';

/** ProjectRoom DO names. Project rooms keep the bare id; workspace rooms are prefixed so the two can't collide. */
export const roomName = {
  project: (projectId: string) => projectId,
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
};

/** Fan out to a project's dashboards. Call only after the DB transaction committed. */
export async function broadcast(env: Env, projectId: string, payload: WsPayload): Promise<void> {
  const stub = env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(roomName.project(projectId)));
  await stub.broadcast(payload);
}

/** Fan out to everyone in a workspace, for events that may precede any project (skill import). */
export async function broadcastWorkspace(env: Env, workspaceId: string, payload: WsPayload): Promise<void> {
  const stub = env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(roomName.workspace(workspaceId)));
  await stub.broadcast(payload);
}

/**
 * After a workspace (and its projects) is deleted: close its rooms and clear their replay buffers.
 * Best effort; a room that is unreachable holds no sockets that can reconnect, since the Worker now 404s.
 */
export async function closeRooms(env: Env, workspaceId: string, projectIds: string[]): Promise<void> {
  const names = [roomName.workspace(workspaceId), ...projectIds.map(roomName.project)];
  await Promise.all(
    names.map((n) =>
      Promise.resolve()
        .then(() => env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(n)).close('Workspace deleted'))
        .catch(() => {}),
    ),
  );
}
