import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectProjectSocket, PROJECT_QUERIES } from './project-socket';
import { ids } from '@hakit/contracts/fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function socket() {
  const ws = { onopen: null, onmessage: null, onerror: null, onclose: null,
    send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
  return { ws, open: () => ws.onopen?.call(ws, new Event('open')),
    message: (data: unknown) => ws.onmessage?.call(ws, { data } as MessageEvent),
    fail: (code = 1006) => ws.onclose?.call(ws, { code } as CloseEvent) };
}
function setup() {
  const sockets: ReturnType<typeof socket>[] = [];
  const createSocket = vi.fn(() => { const s = socket(); sockets.push(s); return s.ws; });
  const status = vi.fn(); const invalidate = vi.fn(); const onEvent = vi.fn();
  const stop = connectProjectSocket({ createSocket, status, invalidate, onEvent });
  return { sockets, createSocket, status, invalidate, onEvent, stop };
}
const event = (seq: number, type = 'board.changed', data: unknown = { reason: 'test' }) =>
  JSON.stringify({ v: 1, seq, at: '2026-10-10T12:00:00Z', type, data });

describe('project connection recovery', () => {
  it('starts hello with no cursor and refreshes project snapshots on open', () => {
    const s = setup(); s.sockets[0]!.open();
    expect(s.sockets[0]!.ws.send).toHaveBeenCalledWith('{"type":"hello","lastSeq":null}');
    expect(s.invalidate).toHaveBeenCalledWith(PROJECT_QUERIES);
    expect(s.status).toHaveBeenLastCalledWith({ state: 'open', polling: false, presence: [] });
    s.stop();
  });
  it('resumes from the last sequence on reconnect', () => {
    const s = setup(); s.sockets[0]!.open(); s.sockets[0]!.message(event(7)); s.sockets[0]!.fail();
    vi.advanceTimersByTime(500); s.sockets[1]!.open();
    expect(s.sockets[1]!.ws.send).toHaveBeenCalledWith('{"type":"hello","lastSeq":7}');
    s.stop();
  });
  it('uses bounded backoff without resetting the 15-second polling deadline', () => {
    const status = vi.fn(); const invalidate = vi.fn();
    const createSocket = vi.fn(() => { throw new Error('offline'); });
    const stop = connectProjectSocket({ createSocket, status, invalidate });
    vi.advanceTimersByTime(14_999);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(status).toHaveBeenLastCalledWith({ state: 'closed', polling: true, presence: [] });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(['missionControl']);
    vi.advanceTimersByTime(10_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(createSocket.mock.calls.length).toBeLessThan(10);
    stop();
  });
  it('times out a connection that never opens and still starts fallback', () => {
    const s = setup(); vi.advanceTimersByTime(10_000);
    expect(s.sockets[0]!.ws.close).toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(s.status.mock.calls.at(-1)?.[0].polling).toBe(true);
    expect(s.invalidate).toHaveBeenCalledWith(['missionControl']);
    s.stop();
  });
  it('stops polling after reconnection and refreshes snapshots immediately', () => {
    const s = setup(); vi.advanceTimersByTime(15_000);
    const current = s.sockets.at(-1)!; current.open();
    expect(s.status).toHaveBeenLastCalledWith({ state: 'open', polling: false, presence: [] });
    s.invalidate.mockClear(); vi.advanceTimersByTime(10_000);
    expect(s.invalidate).not.toHaveBeenCalled();
    s.stop();
  });
  it('ignores malformed JSON and invalid messages without crashing', () => {
    const s = setup(); s.sockets[0]!.open();
    for (const value of ['{', '{}', 'null', event(-1), new ArrayBuffer(1)])
      expect(() => s.sockets[0]!.message(value)).not.toThrow();
    expect(s.onEvent).not.toHaveBeenCalled(); s.stop();
  });
  it('ignores duplicate/out-of-order sequences and refreshes on a gap', () => {
    const s = setup(); const ws = s.sockets[0]!; ws.open(); s.invalidate.mockClear();
    ws.message(event(3)); ws.message(event(3)); ws.message(event(2)); ws.message(event(5));
    expect(s.onEvent).toHaveBeenCalledTimes(2);
    expect(s.invalidate).toHaveBeenCalledWith(PROJECT_QUERIES); s.stop();
  });
  it('updates presence and clears stale online users after disconnect', () => {
    const s = setup(); s.sockets[0]!.open();
    s.sockets[0]!.message(event(1, 'presence', { userIds: [ids.users.priya] }));
    expect(s.status.mock.calls.at(-1)?.[0].presence).toEqual([ids.users.priya]);
    s.sockets[0]!.fail(); expect(s.status.mock.calls.at(-1)?.[0].presence).toEqual([]); s.stop();
  });
  it('detects an unresponsive open socket with ping/pong', () => {
    const s = setup(); s.sockets[0]!.open(); vi.advanceTimersByTime(30_000);
    expect(s.sockets[0]!.ws.send).toHaveBeenLastCalledWith('{"type":"ping"}');
    vi.advanceTimersByTime(10_000);
    expect(s.sockets[0]!.ws.close).toHaveBeenCalled(); s.stop();
  });
  it('keeps a responsive socket open after pong', () => {
    const s = setup(); s.sockets[0]!.open(); vi.advanceTimersByTime(30_000);
    s.sockets[0]!.message('{"type":"pong"}'); vi.advanceTimersByTime(10_000);
    expect(s.sockets[0]!.ws.close).not.toHaveBeenCalled(); s.stop();
  });
  it('handles error events even if a close event never follows', () => {
    const s = setup(); s.sockets[0]!.ws.onerror?.call(s.sockets[0]!.ws, new Event('error'));
    vi.advanceTimersByTime(500); expect(s.sockets).toHaveLength(2); s.stop();
  });
  it('resets the resume cursor after a server sequence reset', () => {
    const s = setup(); s.sockets[0]!.open(); s.sockets[0]!.message(event(99)); s.sockets[0]!.fail(1012);
    vi.advanceTimersByTime(500); s.sockets[1]!.open();
    expect(s.sockets[1]!.ws.send).toHaveBeenCalledWith('{"type":"hello","lastSeq":null}'); s.stop();
  });
  it('cleans up timers and ignores callbacks from the previous project connection', () => {
    const s = setup(); const stale = s.sockets[0]!.ws.onmessage!; s.stop();
    stale.call(s.sockets[0]!.ws, { data: event(1) } as MessageEvent);
    vi.advanceTimersByTime(100_000);
    expect(s.onEvent).not.toHaveBeenCalled(); expect(s.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    const next = setup(); next.sockets[0]!.open();
    expect(next.sockets[0]!.ws.send).toHaveBeenCalledWith('{"type":"hello","lastSeq":null}'); next.stop();
  });
});
