/**
 * Live project updates (ARCHITECTURE §7). Owner: GH (T-404). Mounted once per project screen.
 * Each WS event invalidates the queries that render it; after 15s disconnected, Mission Control polls.
 */
import { useEffect, useRef, useState } from 'react';
import { WsEnvelope, type WsEventType, type EndpointName } from '@hakit/contracts';
import { queryClient } from './query';

const INVALIDATES: Record<WsEventType, EndpointName[]> = {
  'activity.created': ['listActivity', 'missionControl'],
  'task.updated': ['getBoard', 'missionControl'],
  'board.changed': ['getBoard', 'missionControl'],
  'recommendation.created': ['listRecommendations', 'missionControl'],
  'recommendation.resolved': ['listRecommendations', 'missionControl', 'getBoard'],
  'agent_session.updated': ['listAgentSessions', 'missionControl'],
  presence: [],
  'plan.progress': [],
  'health.updated': ['missionControl'],
  'skills.import_progress': ['memberSkills'],
  'member.joined': ['listMembers', 'teamCapability'],
};

export type SocketState = 'connecting' | 'open' | 'closed';

export function useProjectSocket(projectId: string | undefined, onEvent?: (e: WsEnvelope) => void) {
  const [state, setState] = useState<SocketState>('connecting');
  const [presence, setPresence] = useState<string[]>([]);
  const lastSeq = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!projectId) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      setState('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/v1/projects/${projectId}/ws`);
      ws.onopen = () => {
        retry = 0;
        setState('open');
        ws?.send(JSON.stringify({ type: 'hello', lastSeq: lastSeq.current }));
      };
      ws.onmessage = (m) => {
        const parsed = WsEnvelope.safeParse(JSON.parse(String(m.data)));
        if (!parsed.success) return;
        const e = parsed.data;
        lastSeq.current = e.seq;
        if (e.type === 'presence') setPresence(e.data.userIds);
        for (const name of INVALIDATES[e.type]) void queryClient.invalidateQueries({ queryKey: [name] });
        onEventRef.current?.(e);
      };
      ws.onclose = () => {
        setState('closed');
        if (stopped) return;
        timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [projectId]);

  return { state, presence };
}
