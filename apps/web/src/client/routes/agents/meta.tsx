/** Display metadata for coding-agent sessions, shared by S13 Agents and the S4 profile Agents tab. */
import type { AgentSession, AgentSessionStatus } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { Pill } from '../page-states';

/** How each backend status looks. The dot colour is always paired with a word. */
export const SESSION_STATUS: Record<
  AgentSessionStatus,
  { label: string; dot: string; tone: 'success' | 'warning' | 'danger' | 'muted' }
> = {
  active: { label: 'Running', dot: 'bg-success', tone: 'success' },
  awaiting_input: { label: 'Needs input', dot: 'bg-warning', tone: 'warning' },
  idle: { label: 'Idle', dot: 'bg-disabled', tone: 'muted' },
  error: { label: 'Error', dot: 'bg-danger', tone: 'danger' },
  ended: { label: 'Done', dot: 'bg-disabled', tone: 'muted' },
};

/** Sessions that need a human come first, finished ones last. */
export const SESSION_ORDER: AgentSessionStatus[] = ['awaiting_input', 'error', 'active', 'idle', 'ended'];

export const AGENT_NAME: Record<AgentSession['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  other: 'Agent',
};

export function SessionStatusPill({ status }: { status: AgentSessionStatus }) {
  const s = SESSION_STATUS[status];
  return (
    <Pill tone={s.tone}>
      <span aria-hidden className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </Pill>
  );
}

/** Turns `{ Edit: 12, Bash: 5 }` into "12 edits · 5 commands". Tool names come from Claude Code hooks. */
export function toolSummary(counts: Record<string, number>) {
  const words: Record<string, [string, string]> = {
    Edit: ['edit', 'edits'],
    Write: ['file written', 'files written'],
    Read: ['file read', 'files read'],
    Bash: ['command', 'commands'],
  };
  const parts = Object.entries(counts).map(([tool, n]) => {
    const w = words[tool];
    return w ? `${n} ${n === 1 ? w[0] : w[1]}` : `${n} × ${tool}`;
  });
  return parts.length ? parts.join(' · ') : 'No tool use yet';
}
