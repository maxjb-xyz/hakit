/**
 * Shell inspector (DESIGN §6, T-104): a contextual right panel driven by `?task=HK-12`, so any screen can
 * peek at a task without leaving it. Shows the essentials plus the assignment explanation from
 * `explainAssignment` (engine-computed score, reasons, alternatives). The Tasks screen has its own
 * full inspector for the same param, so the shell one stays out of its way there.
 * Wide screens: a column beside the page. Below `lg`: a full-screen sheet (DESIGN §6 mobile).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Assignment, AssignmentExplanation, Member, ScoreBreakdown, Task } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api, ApiRequestError } from '../lib/api';
import { useProject } from '../lib/project';
import { qk } from '../lib/query';
import { AiGlyph } from '../routes/mission-control/RecommendationList';
import { fmtHours, memberName } from '../routes/mission-control/shared';
import { STATUS_LABEL, StatusIcon } from '../routes/tasks/meta';
import { isTyping } from './keys';

const REASON: Record<string, string> = {
  STRONG_SKILL_MATCH: 'Strong skill match',
  PARTIAL_SKILL_MATCH: 'Partial skill match',
  RELATED_SKILL: 'Related skill',
  SEMANTIC_MATCH: 'Similar past work',
  BALANCES_LOAD: 'Balances workload',
  NEAR_CAPACITY: 'Near capacity',
  LEARNING_GOAL: 'Learning goal',
  AVOIDED_SKILL: 'Prefers to avoid',
  OWNS_PREDECESSOR: 'Owns the task before',
  OWNS_SUCCESSOR: 'Owns the task after',
  AVAILABLE_AT_START: 'Available at start',
  UNAVAILABLE_AT_START: 'Unavailable at start',
  CRITICAL_PATH: 'On the critical path',
  ONLY_QUALIFIED: 'Only qualified person',
  OVERRIDE_LOCKED: 'Locked by a person',
  MANUAL: 'Picked by a person',
};

/** `STRONG_SKILL_MATCH:react` → "Strong skill match · react". */
export const reasonText = (code: string) => {
  const [head = '', arg] = code.split(':');
  const text = REASON[head] ?? head.toLowerCase().replace(/_/g, ' ');
  return arg ? `${text} · ${arg}` : text;
};

const TERMS: [keyof Omit<ScoreBreakdown, 'total' | 'relevanceParts'>, string][] = [
  ['relevance', 'Skill relevance'],
  ['workload', 'Workload'],
  ['preference', 'Preference'],
  ['continuity', 'Continuity'],
  ['availability', 'Availability'],
  ['criticalPathPenalty', 'Critical-path penalty'],
];

const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(2)}`;

function Section(props: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-hover px-5 py-4">
      <h3 className="mb-2 flex items-center gap-2 text-label font-medium text-muted">
        {props.title}
        {props.meta}
      </h3>
      {props.children}
    </section>
  );
}

function Breakdown({ b }: { b: ScoreBreakdown }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-label">
      {TERMS.map(([k, label]) => (
        <div key={k} className="contents">
          <dt className="text-subtle">{label}</dt>
          <dd className="text-right font-mono text-default">
            {signed(k === 'criticalPathPenalty' ? -b[k] : b[k])}
          </dd>
        </div>
      ))}
      <div className="contents">
        <dt className="border-t border-hover pt-1 text-default">Total</dt>
        <dd className="border-t border-hover pt-1 text-right font-mono text-strong">{b.total.toFixed(2)}</dd>
      </div>
    </dl>
  );
}

function Explanation(props: { data: AssignmentExplanation; member: (id: string) => Member | undefined }) {
  const a: Assignment = props.data.assignment;
  const pick = props.data.solverPick;
  return (
    <div className="space-y-4">
      <p className="text-body text-default">
        {a.explanationSource === 'ai' && (
          <span className="mr-1.5 inline-flex items-center gap-1 text-label text-subtle">
            <AiGlyph /> AI-worded ·
          </span>
        )}
        {a.explanation}
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-label text-subtle">
        <span>
          {a.source === 'solver'
            ? 'Picked by the solver'
            : a.source === 'manual'
              ? 'Picked by a person'
              : 'From a suggestion'}
        </span>
        {a.locked && <span>· Locked</span>}
        {a.status === 'proposed' && <span>· Proposed, not accepted yet</span>}
      </p>
      {a.reasonCodes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Reasons">
          {a.reasonCodes.map((r) => (
            <li
              key={r}
              className="inline-flex h-control-sm items-center rounded-full border border-border px-2 text-label text-muted"
            >
              {reasonText(r)}
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="mb-1.5 text-label text-subtle">Score (computed by the engine)</p>
        <Breakdown b={a.breakdown} />
      </div>
      {pick && (
        <p className="rounded-sm border border-border px-3 py-2 text-label text-default">
          The solver would pick {memberName(props.member(pick.userId))} (score {pick.score.toFixed(2)},{' '}
          {signed(pick.delta)} vs this choice).
        </p>
      )}
      <div>
        <p className="mb-1.5 text-label text-subtle">Next best</p>
        {a.alternatives.length === 0 ? (
          <p className="text-label text-subtle">No other qualified person.</p>
        ) : (
          <ul className="space-y-1">
            {a.alternatives.slice(0, 2).map((alt) => (
              <li key={alt.userId} className="flex items-baseline gap-2 text-label">
                <span className="min-w-0 flex-1 truncate text-default">
                  {memberName(props.member(alt.userId))}
                </span>
                <span className="text-subtle">score {alt.score.toFixed(2)}</span>
                <span
                  className={cn('w-12 text-right font-mono', alt.delta < 0 ? 'text-muted' : 'text-default')}
                >
                  {signed(alt.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AssignmentSection({ task, member }: { task: Task; member: (id: string) => Member | undefined }) {
  const q = useQuery({
    queryKey: qk('explainAssignment', { tid: task.id }),
    queryFn: () => api('explainAssignment', { params: { tid: task.id } }),
    retry: (n, e) => !(e instanceof ApiRequestError && e.status === 404) && n < 2,
  });
  const unassigned = q.error instanceof ApiRequestError && q.error.status === 404;
  return (
    <Section
      title="Assignment"
      meta={task.assigneeId && <span className="text-subtle">{memberName(member(task.assigneeId))}</span>}
    >
      {q.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading assignment">
          <div className="h-4 animate-pulse rounded-xs bg-raised" />
          <div className="h-16 animate-pulse rounded-xs bg-raised" />
        </div>
      ) : unassigned ? (
        <p className="text-body text-subtle">
          No one is assigned yet. Run the solver from Plan, or pick someone on the task.
        </p>
      ) : q.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-label">
          <span className="text-danger">Couldn't load the explanation.</span>
          <span className="text-subtle">{q.error.message}</span>
          <Button size="sm" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <Explanation data={q.data} member={member} />
      )}
    </Section>
  );
}

export function Inspector({ taskKey }: { taskKey: string }) {
  const { wid = '' } = useParams();
  const [, setSearch] = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<Element | null>(null);
  const { pid } = useProject(wid);
  const board = useQuery({
    queryKey: qk('getBoard', { pid: pid ?? '' }),
    queryFn: () => api('getBoard', { params: { pid: pid! } }),
    enabled: !!pid,
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });
  const task = board.data?.tasks.find((t) => t.key === taskKey);
  const member = (id: string) => members.data?.find((m) => m.user.id === id);

  const close = () =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        return next;
      },
      { replace: true },
    );

  // Move focus into the panel when it opens (and back when it closes) so keyboard users land on it.
  useEffect(() => {
    returnTo.current ??= document.activeElement;
    headingRef.current?.focus();
  }, [taskKey]);
  useEffect(
    () => () => {
      if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) returnTo.current.focus();
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <aside
      aria-labelledby="inspector-h"
      className="flex min-h-0 animate-slide-in-right flex-col overflow-y-auto border-l border-hover bg-raised max-lg:fixed max-lg:inset-0 max-lg:z-10 max-lg:border-l-0 lg:w-(--spacing-inspector) lg:shrink-0"
    >
      <header className="sticky top-0 flex items-center gap-2 border-b border-hover bg-raised px-5 py-3">
        <span className="font-mono text-label text-subtle">{taskKey}</span>
        <Link
          to={`/w/${wid}/tasks?task=${taskKey}`}
          className="ml-auto rounded-xs px-1 text-label text-subtle underline-offset-2 hover:text-strong hover:underline"
        >
          Open in Tasks
        </Link>
        <button
          type="button"
          onClick={close}
          aria-label="Close inspector"
          title="Close (Esc)"
          className="rounded-xs px-1 text-label text-subtle hover:text-strong"
        >
          Close
        </button>
      </header>

      {board.isPending ? (
        <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading task">
          <h2 id="inspector-h" ref={headingRef} tabIndex={-1} className="sr-only">
            Loading {taskKey}
          </h2>
          <div className="h-6 animate-pulse rounded-xs bg-hover" />
          <div className="h-20 animate-pulse rounded-xs bg-hover" />
        </div>
      ) : board.isError ? (
        <div role="alert" className="space-y-3 p-5">
          <h2 id="inspector-h" ref={headingRef} tabIndex={-1} className="text-body text-default">
            Couldn't load {taskKey}.
          </h2>
          <p className="text-label text-subtle">{board.error.message} Nothing has been lost.</p>
          <Button size="sm" onClick={() => void board.refetch()}>
            Retry
          </Button>
        </div>
      ) : !task ? (
        <div className="space-y-2 p-5">
          <h2 id="inspector-h" ref={headingRef} tabIndex={-1} className="text-body text-default">
            No task {taskKey} on this board.
          </h2>
          <p className="text-label text-subtle">
            It may have been removed or the link is from another project.
          </p>
        </div>
      ) : (
        <>
          <div className="px-5 py-4">
            <h2
              id="inspector-h"
              ref={headingRef}
              tabIndex={-1}
              className={cn('text-title text-strong', task.status === 'cut' && 'line-through')}
            >
              {task.title}
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
              <dt className="text-subtle">Status</dt>
              <dd className="flex items-center gap-1.5 text-default">
                <StatusIcon status={task.status} />
                {STATUS_LABEL[task.status]}
              </dd>
              <dt className="text-subtle">Assignee</dt>
              <dd className="text-default">
                {task.assigneeId ? memberName(member(task.assigneeId)) : 'Unassigned'}
              </dd>
              <dt className="text-subtle">Estimate</dt>
              <dd className="text-default">{fmtHours(task.estimateHours)} (estimated)</dd>
              <dt className="text-subtle">Priority</dt>
              <dd className="text-default capitalize">{task.priority.replace(/_/g, ' ')}</dd>
            </dl>
            {task.description && (
              <p className="mt-4 whitespace-pre-line text-body text-muted">{task.description}</p>
            )}
          </div>
          {task.acceptanceCriteria.length > 0 && (
            <Section
              title="Acceptance criteria"
              meta={<span className="text-subtle">{task.acceptanceCriteria.length}</span>}
            >
              <ul className="list-disc space-y-1 pl-4 text-body text-default">
                {task.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Section>
          )}
          {task.requiredSkills.length > 0 && (
            <Section title="Required skills">
              <ul className="flex flex-wrap gap-1.5">
                {task.requiredSkills.map((s) => (
                  <li
                    key={s.skillSlug}
                    className="inline-flex h-control-sm items-center rounded-full border border-border px-2 text-label text-muted"
                  >
                    {s.skillSlug} · level {s.level}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <AssignmentSection task={task} member={member} />
        </>
      )}
    </aside>
  );
}
