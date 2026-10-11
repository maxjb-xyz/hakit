/** React integration for the tested project connection/retry controller. Owner: GH (T-404). */
import { useEffect, useRef, useState } from 'react';
import type { WsEnvelope, EndpointName } from '@hakit/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { queryClient } from './query';
import { connectProjectSocket, PROJECT_QUERIES, type ConnectionStatus } from './project-socket';
export type { SocketState } from './project-socket';

export function invalidateProjectQueries(client: QueryClient, projectId: string, names: EndpointName[]) {
  if (names.length === 0) return;
  void client.invalidateQueries({
    predicate: (query) => {
      const name = query.queryKey[0] as EndpointName;
      if (!names.includes(name)) return false;
      if (!PROJECT_QUERIES.includes(name)) return true;
      const params = query.queryKey[1];
      return typeof params === 'object' && params !== null && 'pid' in params && params.pid === projectId;
    },
  });
}

export function useProjectSocket(projectId: string | undefined, onEvent?: (e: WsEnvelope) => void) {
  return useRoomSocket(
    projectId && {
      key: projectId,
      path: `/api/v1/projects/${encodeURIComponent(projectId)}/ws`,
      projectId,
    },
    onEvent,
  );
}

/** Workspace room: events that can happen before any project exists (skill import during onboarding). */
export function useWorkspaceSocket(workspaceId: string | undefined, onEvent?: (e: WsEnvelope) => void) {
  return useRoomSocket(
    workspaceId && {
      key: `workspace:${workspaceId}`,
      path: `/api/v1/w/${encodeURIComponent(workspaceId)}/ws`,
    },
    onEvent,
  );
}

interface Room {
  key: string;
  path: string;
  /** Project rooms also refresh that project's queries; workspace rooms refresh only workspace-level ones. */
  projectId?: string;
}

function useRoomSocket(room: Room | undefined | '', onEvent?: (e: WsEnvelope) => void) {
  const [connection, setConnection] = useState<ConnectionStatus & { key?: string }>({
    state: 'connecting',
    polling: false,
    presence: [],
  });
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  const key = room ? room.key : undefined;
  const path = room ? room.path : undefined;
  const projectId = room ? (room.projectId ?? '') : '';
  useEffect(() => {
    if (!key || !path) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return connectProjectSocket({
      createSocket: () => new WebSocket(`${proto}://${location.host}${path}`),
      status: (status) => setConnection({ ...status, key }),
      invalidate: (names) => invalidateProjectQueries(queryClient, projectId, names),
      onEvent: (event) => onEventRef.current?.(event),
    });
  }, [key, path, projectId]);
  if (!key) return { state: 'closed' as const, polling: false, presence: [] };
  if (connection.key !== key) return { state: 'connecting' as const, polling: false, presence: [] };
  return connection;
}
