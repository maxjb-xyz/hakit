/** React integration for the tested project connection/retry controller. Owner: GH (T-404). */
import { useEffect, useRef, useState } from 'react';
import type { WsEnvelope, EndpointName } from '@hakit/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { queryClient } from './query';
import { connectProjectSocket, PROJECT_QUERIES, type ConnectionStatus } from './project-socket';
export type { SocketState } from './project-socket';

export function invalidateProjectQueries(client: QueryClient, projectId: string, names: EndpointName[]) {
  if (names.length === 0) return;
  void client.invalidateQueries({ predicate: query => {
    const name = query.queryKey[0] as EndpointName;
    if (!names.includes(name)) return false;
    if (!PROJECT_QUERIES.includes(name)) return true;
    const params = query.queryKey[1];
    return typeof params === 'object' && params !== null && 'pid' in params && params.pid === projectId;
  } });
}

export function useProjectSocket(projectId: string | undefined, onEvent?: (e: WsEnvelope) => void) {
  const [connection, setConnection] = useState<ConnectionStatus & { projectId?: string }>({ state: 'connecting', polling: false, presence: [] });
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => {
    if (!projectId) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return connectProjectSocket({
      createSocket: () => new WebSocket(`${proto}://${location.host}/api/v1/projects/${encodeURIComponent(projectId)}/ws`),
      status: status => setConnection({ ...status, projectId }),
      invalidate: names => invalidateProjectQueries(queryClient, projectId, names),
      onEvent: event => onEventRef.current?.(event),
    });
  }, [projectId]);
  if (!projectId) return { state: 'closed' as const, polling: false, presence: [] };
  if (connection.projectId !== projectId) return { state: 'connecting' as const, polling: false, presence: [] };
  return connection;
}
