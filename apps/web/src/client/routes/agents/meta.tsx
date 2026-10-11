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

const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-subtle',
} as const;

/**
 * Shape-coded state icon (never colour alone): running = rotating arc, needs input = pause bars,
 * error = cross, idle = hollow ring, done = check. Always paired with the state word.
 */
export function SessionStateIcon({ status, className }: { status: AgentSessionStatus; className?: string }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
    className: cn('size-3.5 shrink-0', TONE_TEXT[SESSION_STATUS[status].tone], className),
  };
  switch (status) {
    case 'active':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" opacity="0.3" />
          <path
            d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
            className="origin-center animate-spin [animation-duration:1.4s]"
          />
        </svg>
      );
    case 'awaiting_input':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M6.5 6v4M9.5 6v4" />
        </svg>
      );
    case 'error':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </svg>
      );
    case 'idle':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2.4" />
        </svg>
      );
    case 'ended':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M5.75 8.25l1.5 1.5 3-3.25" />
        </svg>
      );
  }
}

/** Status icon + word. Keyed by status so a live transition pops in (DESIGN §5). */
export function SessionStatusPill({ status }: { status: AgentSessionStatus }) {
  const s = SESSION_STATUS[status];
  return (
    <Pill tone={s.tone} className="gap-1.5">
      <span key={status} className="inline-flex animate-pop-in items-center gap-1.5">
        <SessionStateIcon status={status} className="size-3" />
        {s.label}
      </span>
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
