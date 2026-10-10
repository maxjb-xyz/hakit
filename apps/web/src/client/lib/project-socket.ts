import { WsEnvelope, type EndpointName, type WsEventType } from '@hakit/contracts';

export const INVALIDATES: Record<WsEventType, EndpointName[]> = {
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
export const PROJECT_QUERIES: EndpointName[] = [
  'missionControl',
  'listActivity',
  'getBoard',
  'listRecommendations',
  'listAgentSessions',
];
export type SocketState = 'connecting' | 'open' | 'closed';
export interface ConnectionStatus {
  state: SocketState;
  polling: boolean;
  presence: string[];
}
interface Options {
  createSocket(): WebSocket;
  status(value: ConnectionStatus): void;
  invalidate(names: EndpointName[]): void;
  onEvent?(event: WsEnvelope): void;
}

/** One controller per project; retries never reset the 15-second fallback deadline. */
export function connectProjectSocket(options: Options): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let lastSeq: number | null = null;
  let state: SocketState = 'connecting';
  let polling = false;
  let presence: string[] = [];
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => options.status({ state, polling, presence });
  const fallback = () => {
    if (fallbackTimer !== undefined || pollTimer !== undefined) return;
    fallbackTimer = setTimeout(() => {
      fallbackTimer = undefined;
      if (stopped) return;
      polling = true;
      notify();
      options.invalidate(['missionControl']);
      pollTimer = setInterval(() => options.invalidate(['missionControl']), 10_000);
    }, 15_000);
  };
  const clearSocketTimers = () => {
    clearTimeout(connectTimer);
    clearInterval(heartbeatTimer);
    clearTimeout(pongTimer);
    connectTimer = undefined;
    heartbeatTimer = undefined;
    pongTimer = undefined;
  };
  const detach = (socket: WebSocket) => {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  };
  const failed = (socket: WebSocket | null, code?: number) => {
    if (stopped || (socket !== null && socket !== ws)) return;
    if (code === 1012) lastSeq = null;
    clearSocketTimers();
    if (socket) detach(socket);
    ws = null;
    state = 'closed';
    presence = [];
    notify();
    fallback();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, Math.min(15_000, 500 * 2 ** Math.min(retry++, 5)));
  };
  const connect = () => {
    if (stopped) return;
    state = 'connecting';
    notify();
    fallback();
    let socket: WebSocket;
    try {
      socket = options.createSocket();
    } catch {
      failed(null);
      return;
    }
    ws = socket;
    connectTimer = setTimeout(() => failed(socket), 10_000);
    socket.onopen = () => {
      if (stopped || socket !== ws) return;
      clearTimeout(connectTimer);
      clearTimeout(fallbackTimer);
      clearInterval(pollTimer);
      fallbackTimer = undefined;
      pollTimer = undefined;
      polling = false;
      retry = 0;
      state = 'open';
      notify();
      try {
        socket.send(JSON.stringify({ type: 'hello', lastSeq }));
      } catch {
        failed(socket);
        return;
      }
      options.invalidate(PROJECT_QUERIES);
      heartbeatTimer = setInterval(() => {
        if (pongTimer !== undefined) return;
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          failed(socket);
          return;
        }
        pongTimer = setTimeout(() => failed(socket), 10_000);
      }, 30_000);
    };
    socket.onmessage = (message) => {
      if (stopped || socket !== ws || typeof message.data !== 'string') return;
      let json: unknown;
      try {
        json = JSON.parse(message.data);
      } catch {
        return;
      }
      if (json && typeof json === 'object' && 'type' in json && json.type === 'pong') {
        clearTimeout(pongTimer);
        pongTimer = undefined;
        return;
      }
      const parsed = WsEnvelope.safeParse(json);
      if (!parsed.success) return;
      const event = parsed.data;
      if (lastSeq !== null && event.seq <= lastSeq) return;
      if (lastSeq !== null && event.seq !== lastSeq + 1) options.invalidate(PROJECT_QUERIES);
      lastSeq = event.seq;
      if (event.type === 'presence') {
        presence = event.data.userIds;
        notify();
      }
      options.invalidate(INVALIDATES[event.type]);
      options.onEvent?.(event);
    };
    socket.onclose = (event) => failed(socket, event.code);
    socket.onerror = () => failed(socket);
  };
  connect();
  return () => {
    stopped = true;
    clearSocketTimers();
    clearTimeout(retryTimer);
    clearTimeout(fallbackTimer);
    clearInterval(pollTimer);
    if (ws) detach(ws);
    ws = null;
  };
}
