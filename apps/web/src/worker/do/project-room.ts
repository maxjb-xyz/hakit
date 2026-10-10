/**
 * ProjectRoom — one Durable Object per project; fans out WsEnvelope events to dashboards (ARCHITECTURE §7).
 * Implemented in the scaffold because every workstream depends on it. Owner: GH (T-404 hardening).
 *
 * - WebSocket Hibernation API (idle sockets cost nothing).
 * - Producers call `broadcast(payload)` via RPC *after* their DB commit.
 * - Last 200 events kept in DO SQLite for `hello { lastSeq }` replay after reconnects.
 * - Presence = distinct user ids attached to sockets.
 */
import { DurableObject } from 'cloudflare:workers';
import { Id, WsClientMessage, WsEnvelope, WsPayload } from '@hakit/contracts';
import type { Env } from '../env';

const REPLAY_LIMIT = 200;

export class ProjectRoom extends DurableObject<Env> {
  private seq: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
    const row = ctx.storage.sql.exec<{ s: number | null }>(`SELECT max(seq) AS s FROM events`).one();
    this.seq = row.s ?? 0;
  }

  /** Called by the Worker after it has authenticated the user and checked membership. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected WebSocket', { status: 426 });
    const userId = request.headers.get('x-hakit-user');
    const user = Id.safeParse(userId);
    if (!user.success) return new Response('Missing user', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [user.data]);
    // hello replays first, then broadcasts presence, preserving sequence order on reconnect.
    return new Response(null, { status: 101, webSocket: client });
  }

  /** RPC from routes/jobs/cron. */
  async broadcast(payload: WsPayload): Promise<number> {
    const data = WsPayload.parse(payload);
    const envelope = WsEnvelope.parse({ ...data, v: 1, seq: this.seq + 1, at: new Date().toISOString() });
    const body = JSON.stringify(envelope);
    this.ctx.storage.sql.exec(`INSERT INTO events (seq, body) VALUES (?, ?)`, envelope.seq, body);
    this.seq = envelope.seq;
    this.ctx.storage.sql.exec(`DELETE FROM events WHERE seq <= ?`, envelope.seq - REPLAY_LIMIT);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        /* socket closing; ignore */
      }
    }
    return envelope.seq;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const parsed = WsClientMessage.safeParse(safeJson(message));
    if (!parsed.success) return;
    if (parsed.data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    // hello: replay missed events (or nothing if lastSeq is null/current)
    const since = parsed.data.lastSeq;
    if (since !== null) {
      if (since > this.seq) { ws.close(1012, 'Replay cursor reset'); return; }
      const rows = this.ctx.storage.sql
        .exec<{ body: string }>(`SELECT body FROM events WHERE seq > ? ORDER BY seq`, since)
        .toArray();
      for (const r of rows) ws.send(r.body);
    }
    await this.broadcastPresence();
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
    await this.broadcastPresence();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, 'Socket error'); } catch { /* already closed */ }
    await this.broadcastPresence();
  }

  private async broadcastPresence() {
    const userIds = [...new Set(this.ctx.getWebSockets().filter(ws => ws.readyState === 1).flatMap((ws) => this.ctx.getTags(ws)))];
    await this.broadcast({ type: 'presence', data: { userIds } });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
