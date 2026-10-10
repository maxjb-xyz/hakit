import { describe, expect, it } from 'vitest';
import type { AgentHookEvent } from '@hakit/contracts';
import { activityKindFor, applyHookEvent, initialState, statusFor, timeoutStatus } from './agent-session';

const T0 = '2026-10-10T10:00:00Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const ev = (hookEventName: string, min: number, extra: Partial<AgentHookEvent> = {}): AgentHookEvent => ({
  agent: 'claude_code',
  hookEventName,
  sessionId: 's1',
  ts: at(min),
  ...extra,
});
const run = (...events: AgentHookEvent[]) =>
  events.reduce(applyHookEvent, initialState(new Date(events[0]!.ts)));

describe('agent session state machine (INTEGRATIONS §6.1)', () => {
  it.each([
    ['SessionStart', undefined, 'active'],
    ['UserPromptSubmit', undefined, 'active'],
    ['PreToolUse', undefined, 'active'],
    ['PostToolUse', undefined, 'active'],
    ['Notification', 'permission_prompt', 'awaiting_input'],
    ['Notification', 'idle_prompt', 'awaiting_input'],
    ['Notification', 'elicitation_dialog', 'awaiting_input'],
    ['Notification', 'agent_needs_input', 'awaiting_input'],
    ['Notification', 'auth_success', null],
    ['PermissionRequest', undefined, 'awaiting_input'],
    ['Stop', undefined, 'idle'],
    ['StopFailure', undefined, 'error'],
    ['SessionEnd', undefined, 'ended'],
    ['SubagentStop', undefined, null],
    ['SomethingNew', undefined, null],
  ])('%s (%s) → %s', (hookEventName, notificationType, status) =>
    expect(statusFor({ hookEventName, notificationType })).toBe(status),
  );

  it('walks a session through a turn and keeps awaitingSince from the first prompt', () => {
    const s = run(
      ev('SessionStart', 0),
      ev('PostToolUse', 1, { toolName: 'Edit' }),
      ev('PostToolUse', 2, { toolName: 'Edit' }),
      ev('PermissionRequest', 3),
      ev('Notification', 4, { notificationType: 'permission_prompt' }),
    );
    expect(s.status).toBe('awaiting_input');
    expect(s.summary).toEqual({ toolCounts: { Edit: 2 }, subagents: 0, awaitingSince: at(3) });
    const after = applyHookEvent(s, ev('UserPromptSubmit', 5));
    expect(after.status).toBe('active');
    expect(after.summary.awaitingSince).toBeNull();
    expect(applyHookEvent(after, ev('Stop', 6)).status).toBe('idle');
  });

  it('counts subagents without going negative', () => {
    const s = run(
      ev('SessionStart', 0),
      ev('SubagentStart', 1),
      ev('SubagentStop', 2),
      ev('SubagentStop', 3),
    );
    expect(s.summary.subagents).toBe(0);
    expect(run(ev('SessionStart', 0), ev('SubagentStart', 1)).summary.subagents).toBe(1);
  });

  it('ends on SessionEnd and reopens on a newer event (resume)', () => {
    const ended = run(ev('SessionStart', 0), ev('SessionEnd', 5));
    expect(ended).toMatchObject({ status: 'ended', endedAt: new Date(at(5)) });
    const resumed = applyHookEvent(ended, ev('SessionStart', 9));
    expect(resumed).toMatchObject({ status: 'active', endedAt: null, lastEventAt: new Date(at(9)) });
  });

  it('never moves status backwards on an out-of-order event, but still counts it', () => {
    const s = run(ev('SessionStart', 0), ev('Stop', 5));
    const late = applyHookEvent(s, ev('PostToolUse', 4, { toolName: 'Bash' }));
    expect(late.status).toBe('idle');
    expect(late.lastEventAt).toEqual(new Date(at(5)));
    expect(late.summary.toolCounts).toEqual({ Bash: 1 });
  });

  it('times out active → idle after 10 min and anything → ended after 2h', () => {
    const now = new Date(at(0));
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(timeoutStatus({ status: 'active', lastEventAt: ago(9) }, now)).toBeNull();
    expect(timeoutStatus({ status: 'active', lastEventAt: ago(10) }, now)).toBe('idle');
    expect(timeoutStatus({ status: 'awaiting_input', lastEventAt: ago(60) }, now)).toBeNull();
    expect(timeoutStatus({ status: 'idle', lastEventAt: ago(60) }, now)).toBeNull();
    expect(timeoutStatus({ status: 'awaiting_input', lastEventAt: ago(120) }, now)).toBe('ended');
    expect(timeoutStatus({ status: 'error', lastEventAt: ago(121) }, now)).toBe('ended');
    expect(timeoutStatus({ status: 'ended', lastEventAt: ago(500) }, now)).toBeNull();
  });

  it('records activity only on status transitions', () => {
    expect(activityKindFor(null, 'active', 'SessionStart')).toBe('agent_session_start');
    expect(activityKindFor(null, 'active', 'PostToolUse')).toBe('agent_session_start');
    expect(activityKindFor('idle', 'active', 'SessionStart')).toBe('agent_session_start');
    expect(activityKindFor('idle', 'active', 'UserPromptSubmit')).toBe('agent_active');
    expect(activityKindFor('active', 'active', 'PostToolUse')).toBeNull();
    expect(activityKindFor('active', 'awaiting_input', 'PermissionRequest')).toBe('agent_awaiting_input');
    expect(activityKindFor('active', 'ended', 'SessionEnd')).toBe('agent_session_end');
  });
});
