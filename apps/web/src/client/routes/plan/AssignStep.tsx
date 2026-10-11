/**
 * S9 Assignment review (T-311): solver proposals (`solveAssignments`) as member swimlanes with capacity bars plus an
 * Unassigned column; click a card for the explanation (score breakdown, rationale, top alternatives with deltas,
 * override/lock via `manualAssign`). Rebalance re-runs the solver respecting locks; accept stores the proposals.
 * The solver decides; nothing here is model output except optionally polished explanation prose (marked AI).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Assignment, AssignmentProposal, Member, ProjectBoard, Task } from '@hakit/contracts';
import { Button, TickNumber, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { AiGlyph } from '../mission-control/RecommendationList';
import { fmtHours, memberName } from '../mission-control/shared';
import { MemberAvatar, Picker } from '../tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, Pill } from '../page-states';
import { EstimatedBar, SectionHead, StatusMark, pct, stagger, useGrow } from './ui';

const WARNING_WORD = {
  OVERLOADED_MEMBER: 'Overloaded member',
  UNMET_SKILL: 'Unmet skill requirement',
  SINGLE_OWNER_CHAIN: 'One person owns a dependency chain',
  NO_QUALIFIED_MEMBER: 'No qualified member',
} as const;

const REASON: Record<string, string> = {
  STRONG_SKILL_MATCH: 'Strong skill match',
  PARTIAL_SKILL_MATCH: 'Partial skill match',
  RELATED_SKILL: 'Related skill',
  SEMANTIC_MATCH: 'Similar past work',
  BALANCES_LOAD: 'Balances load',
  NEAR_CAPACITY: 'Near capacity',
  LEARNING_GOAL: 'Learning goal',
  AVOIDED_SKILL: 'Avoided skill',
  OWNS_PREDECESSOR: 'Owns the task before',
  OWNS_SUCCESSOR: 'Owns the task after',
  AVAILABLE_AT_START: 'Available at start',
  UNAVAILABLE_AT_START: 'Unavailable at start',
  CRITICAL_PATH: 'On the critical path',
  ONLY_QUALIFIED: 'Only qualified member',
  OVERRIDE_LOCKED: 'Locked override',
  MANUAL: 'Manual pick',
};
/** Solver score as a match %, clamped for display (scores can dip below 0 with penalties). */
const match = (score: number) => pct(Math.min(1, Math.max(0, score)));

export const reasonText = (code: string) => {
  const [k, arg] = code.split(':');
  return `${REASON[k!] ?? k}${arg ? `: ${arg}` : ''}`;
};

export function AssignStep(props: { pid: string; members: Member[]; onGoToPlan: () => void }) {
  const { pid, members } = props;
  const qc = useQueryClient();
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
  });
  const [proposal, setProposal] = useState<AssignmentProposal | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const solve = useMutation({
    mutationFn: (scope: 'all' | 'unassigned') =>
      api('solveAssignments', { params: { pid }, body: { scope, respectLocks: true } }),
    onSuccess: (p) => {
      setProposal(p);
      setSelectedTask(null);
    },
  });
  const accept = useMutation({
    mutationFn: (ids: string[]) =>
      api('acceptAssignments', { params: { pid }, body: { assignmentIds: ids } }),
    onSuccess: (b) => {
      qc.setQueryData(qk('getBoard', { pid }), b);
      void qc.invalidateQueries({ queryKey: ['missionControl'] });
      setProposal(null);
    },
  });

  if (board.isError)
    return <ErrorBox what="the board" error={board.error} onRetry={() => void board.refetch()} />;
  if (board.isPending) return <LoadingBlocks label="Loading tasks" rows={4} />;
  const b = board.data;
  const open = b.tasks.filter((t) => t.status !== 'cut' && t.status !== 'done');
  if (b.tasks.length === 0)
    return (
      <EmptyBox
        message="No tasks yet. Accept a plan to turn it into tasks, then the solver can propose who does what."
        action={
          <Button variant="primary" onClick={props.onGoToPlan}>
            Go to plan
          </Button>
        }
      />
    );

  const proposed = proposal?.assignments.filter((a) => a.status === 'proposed') ?? [];
  const shown: Assignment[] = proposal
    ? proposal.assignments
    : b.assignments.filter((a) => a.status === 'active');
  const taskById = new Map(b.tasks.map((t) => [t.id, t]));
  const unassigned = proposal
    ? proposal.unassignedTaskIds.map((id) => taskById.get(id)).filter((t): t is Task => !!t)
    : open.filter((t) => !shown.some((a) => a.taskId === t.id));
  const load = (uid: string) => {
    const l = proposal?.load.find((x) => x.userId === uid);
    const assigned =
      l?.assignedHours ??
      shown
        .filter((a) => a.userId === uid)
        .reduce((s, a) => s + (taskById.get(a.taskId)?.estimateHours ?? 0), 0);
    const available =
      l?.availableHours ?? members.find((m) => m.user.id === uid)?.profile.availableHours ?? 0;
    return { assigned, available };
  };
  const selected = selectedTask ? shown.find((a) => a.taskId === selectedTask) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={proposal ? 'accent' : 'muted'}>
          {proposal ? (
            <>
              <span aria-hidden>○</span> Proposal · {proposed.length} to accept
            </>
          ) : (
            <>
              <span aria-hidden>✓</span> Current assignments
            </>
          )}
        </Pill>
        <span className="text-label text-subtle">
          Match % is the solver's score (deterministic). Hours are estimates.
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button
            loading={solve.isPending && solve.variables === 'unassigned'}
            disabled={solve.isPending}
            onClick={() => solve.mutate('unassigned')}
          >
            Propose for unassigned
          </Button>
          <Button
            loading={solve.isPending && solve.variables === 'all'}
            disabled={solve.isPending}
            onClick={() => solve.mutate('all')}
            title="Re-run the solver on every task; locked assignments stay put"
          >
            Rebalance
          </Button>
          {proposal && (
            <>
              <Button variant="ghost" onClick={() => setProposal(null)} disabled={accept.isPending}>
                Discard proposal
              </Button>
              <Button
                variant="primary"
                loading={accept.isPending}
                disabled={proposed.length === 0}
                onClick={() => accept.mutate(proposed.map((a) => a.id))}
              >
                Accept {proposed.length} assignment{proposed.length === 1 ? '' : 's'}
              </Button>
            </>
          )}
        </span>
      </div>
      {(solve.isError || accept.isError) && (
        <div
          role="alert"
          className="rounded-md border border-danger bg-surface px-4 py-3 text-body text-default"
        >
          {solve.isError
            ? `Couldn't run the solver (${solve.error.message}). Current assignments are unchanged.`
            : `Couldn't accept (${accept.error!.message}). Nothing was changed; the proposal is still here.`}
        </div>
      )}
      {accept.isSuccess && !proposal && (
        <p role="status" className="text-label text-success">
          <span aria-hidden>✓ </span>Assignments accepted. They now show on the board and in Mission Control.
        </p>
      )}

      {proposal && proposal.warnings.length > 0 && (
        <ul
          className="space-y-1 rounded-md border border-warning bg-surface px-4 py-3"
          aria-label="Solver warnings"
        >
          {proposal.warnings.map((w) => (
            <li key={`${w.code}-${w.message}`} className="flex flex-wrap items-baseline gap-2 text-body">
              <StatusMark mark="warn" word={WARNING_WORD[w.code]} />
              <span className="text-default">{w.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-(--grid-side-360)">
        <div className="min-w-0 space-y-3">
          {members.length === 0 && <EmptyBox message="No team members yet. Invite teammates first." />}
          {members.map((m, mi) => {
            const l = load(m.user.id);
            const cards = shown.filter((a) => a.userId === m.user.id);
            return (
              <section
                key={m.user.id}
                aria-label={`${memberName(m)}: ${cards.length} tasks`}
                style={stagger(mi)}
                className={cn(
                  'animate-list-in rounded-md border bg-surface',
                  l.assigned > l.available ? 'border-danger' : 'border-border',
                )}
              >
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
                  <MemberAvatar member={m} className="size-7" />
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-strong">{memberName(m)}</span>
                    <span className="block text-caption text-subtle">
                      {cards.length} task{cards.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'ml-auto text-label',
                      l.assigned > l.available ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {l.assigned > l.available && <span aria-hidden>⚠ </span>}≈{fmtHours(l.assigned)} of ≈
                    {fmtHours(l.available)}
                    {l.assigned > l.available && ' · over capacity'}
                  </span>
                  <div className="basis-full">
                    <EstimatedBar
                      value={l.assigned}
                      max={l.available}
                      label={`${memberName(m)}: estimated ${fmtHours(l.assigned)} assigned of ${fmtHours(l.available)} available`}
                    />
                  </div>
                </header>
                {cards.length === 0 ? (
                  <p className="px-4 py-3 text-body text-subtle">Nothing assigned.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2 p-3">
                    {cards.map((a, i) => (
                      <AssignmentCard
                        index={i}
                        key={a.id}
                        a={a}
                        task={taskById.get(a.taskId)}
                        selected={selectedTask === a.taskId}
                        onSelect={() => setSelectedTask(a.taskId === selectedTask ? null : a.taskId)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <section
            aria-label={`Unassigned: ${unassigned.length} tasks`}
            className="rounded-md border border-dashed border-border-strong"
          >
            <header className="flex items-center gap-2 px-4 py-2">
              <MemberAvatar member={undefined} />
              <span className="text-body font-medium text-strong">Unassigned</span>
              <span className="text-label text-subtle">{unassigned.length}</span>
            </header>
            {unassigned.length === 0 ? (
              <p className="px-4 pb-3 text-body text-subtle">Every open task has an owner.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 px-3 pb-3">
                {unassigned.map((t) => (
                  <li key={t.id} className="rounded-sm border border-border px-2.5 py-1.5 text-label">
                    <span className="font-mono text-subtle">{t.key}</span>{' '}
                    <span className="text-default">{t.title}</span>{' '}
                    <span className="text-subtle" title="Estimated hours">
                      ≈{fmtHours(t.estimateHours)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside
          id="assign-explain"
          className="min-w-0 lg:sticky lg:top-4 lg:self-start"
          aria-label="Assignment explanation"
          aria-live="polite"
          onKeyDown={(e) => e.key === 'Escape' && setSelectedTask(null)}
        >
          {selected ? (
            <ExplanationCard
              key={selected.id}
              a={selected}
              task={taskById.get(selected.taskId)}
              members={members}
              board={b}
              pid={pid}
              isProposal={!!proposal}
            />
          ) : (
            <div className="animate-fade-in space-y-2 rounded-md border border-dashed border-border-strong px-4 py-8 text-center text-body text-subtle">
              <span aria-hidden className="block text-title text-faint">
                ?
              </span>
              Select a task card to see why the solver picked that person.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function AssignmentCard(props: {
  index: number;
  a: Assignment;
  task: Task | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const { a, task } = props;
  return (
    <li style={stagger(props.index)} className="max-w-full animate-list-in">
      <button
        type="button"
        aria-pressed={props.selected}
        aria-controls="assign-explain"
        onClick={props.onSelect}
        className={cn(
          'hover-light press flex max-w-full flex-col items-start gap-1 rounded-sm border bg-raised px-2.5 py-1.5 text-left',
          props.selected
            ? 'border-accent-400 shadow-[0_0_0_3px_var(--color-accent-a12)]'
            : 'border-border hover:border-border-strong',
          a.status === 'proposed' && 'border-dashed',
        )}
      >
        <span className="flex items-center gap-1.5 text-label">
          <span className="font-mono text-subtle">{task?.key ?? '?'}</span>
          <span className="truncate text-default">{task?.title ?? 'Unknown task'}</span>
        </span>
        <span className="flex items-center gap-2 text-caption text-subtle">
          <span>{match(a.score)} match</span>
          {task && <span title="Estimated hours">≈{fmtHours(task.estimateHours)}</span>}
          {a.status === 'proposed' && <span>proposed</span>}
          {a.locked && (
            <span>
              <span aria-hidden>🔒︎ </span>locked
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

const BREAKDOWN: [keyof Assignment['breakdown'], string][] = [
  ['relevance', 'Relevance'],
  ['workload', 'Workload balance'],
  ['preference', 'Preference'],
  ['continuity', 'Continuity'],
  ['availability', 'Availability'],
];

function ExplanationCard(props: {
  a: Assignment;
  task: Task | undefined;
  members: Member[];
  board: ProjectBoard;
  pid: string;
  isProposal: boolean;
}) {
  const { a, task, members, pid } = props;
  const qc = useQueryClient();
  const member = (id: string) => members.find((m) => m.user.id === id);
  // Active assignments also get the solver's own pick, so an override shows its delta (T-311).
  const explain = useQuery({
    queryKey: qk('explainAssignment', { tid: a.taskId }),
    queryFn: () => api('explainAssignment', { params: { tid: a.taskId } }),
    enabled: !props.isProposal,
  });
  const [userId, setUserId] = useState(a.userId);
  const override = useMutation({
    mutationFn: (body: { userId: string; lock: boolean }) =>
      api('manualAssign', { params: { tid: a.taskId }, body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk('getBoard', { pid }) });
      void qc.invalidateQueries({ queryKey: qk('explainAssignment', { tid: a.taskId }) });
    },
  });
  const b = a.breakdown;
  const pick = explain.data?.solverPick;

  return (
    <section className="animate-slide-in-right space-y-4 rounded-md border border-border-strong bg-surface p-4 shadow-e2">
      <SectionHead title={task ? `${task.key} · ${task.title}` : 'Assignment'} />
      <div className="flex items-center gap-3 rounded-sm bg-raised px-3 py-2">
        <MemberAvatar member={member(a.userId)} className="size-8" />
        <span className="text-body font-medium text-strong">{memberName(member(a.userId))}</span>
        <span className="ml-auto text-right">
          <TickNumber value={match(a.score)} className="block text-title text-strong" />
          <span className="block text-caption text-subtle">match</span>
        </span>
      </div>
      <p
        className={cn('text-body text-default', a.explanationSource === 'ai' && 'border-l-2 border-ai pl-2')}
      >
        {a.explanationSource === 'ai' && (
          <span className="mr-1 inline-flex items-center gap-1 text-caption text-subtle">
            <AiGlyph /> AI-phrased
          </span>
        )}
        {a.explanation}
      </p>
      {a.reasonCodes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Reasons">
          {a.reasonCodes.map((r) => (
            <li key={r}>
              <Pill>{reasonText(r)}</Pill>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="text-caption uppercase tracking-wide text-subtle">Score breakdown</h3>
        <table className="mt-1 w-full text-label">
          <tbody>
            {BREAKDOWN.map(([k, label]) => (
              <tr key={k} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-1 text-left font-normal text-muted">
                  {label}
                </th>
                <td className="w-1/3 py-1 pl-3">
                  <ScoreBar value={b[k] as number} />
                </td>
                <td className="w-12 py-1 text-right font-mono text-default">{(b[k] as number).toFixed(2)}</td>
              </tr>
            ))}
            {b.criticalPathPenalty !== 0 && (
              <tr className="border-b border-border">
                <th scope="row" className="py-1 text-left font-normal text-muted">
                  Critical-path penalty
                </th>
                <td />
                <td className="py-1 text-right font-mono text-danger">
                  −{Math.abs(b.criticalPathPenalty).toFixed(2)}
                </td>
              </tr>
            )}
            <tr>
              <th scope="row" className="py-1 text-left font-medium text-strong">
                Total
              </th>
              <td />
              <td className="py-1 text-right font-mono text-strong">{b.total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-caption text-subtle">
          Relevance parts: skill {pct(b.relevanceParts.skillFit)} · similar work{' '}
          {pct(b.relevanceParts.semanticFit)} · interest {pct(b.relevanceParts.interestFit)}
        </p>
      </div>

      <div>
        <h3 className="text-caption uppercase tracking-wide text-subtle">Alternatives</h3>
        {a.alternatives.length === 0 ? (
          <p className="text-body text-subtle">No one else qualifies.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {a.alternatives.slice(0, 2).map((alt) => (
              <li key={alt.userId} className="flex items-center gap-2 text-label">
                <MemberAvatar member={member(alt.userId)} />
                <span className="text-default">{memberName(member(alt.userId))}</span>
                <span className="text-subtle">{alt.reasonCodes.map(reasonText).join(', ')}</span>
                <span className="ml-auto font-mono text-default">
                  {match(alt.score)} ({alt.delta >= 0 ? '+' : '−'}
                  {Math.abs(alt.delta).toFixed(2)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pick && pick.userId !== a.userId && (
        <p className="text-label text-warning">
          <span aria-hidden>⚠ </span>Manual override. The solver would pick {memberName(member(pick.userId))}{' '}
          ({match(pick.score)}, {pick.delta >= 0 ? '+' : '−'}
          {Math.abs(pick.delta).toFixed(2)} vs this choice).
        </p>
      )}

      {!props.isProposal && (
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-caption uppercase tracking-wide text-subtle">Override</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Picker label="Assign to" value={userId} onChange={setUserId}>
              {members.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {memberName(m)}
                </option>
              ))}
            </Picker>
            <Button
              size="sm"
              loading={override.isPending}
              disabled={userId === a.userId && a.locked}
              onClick={() => override.mutate({ userId, lock: true })}
            >
              {userId === a.userId ? 'Lock' : 'Reassign & lock'}
            </Button>
          </div>
          {override.isError && (
            <p role="alert" className="text-label text-danger">
              Couldn't save ({override.error.message}). The assignment is unchanged.
            </p>
          )}
          {override.isSuccess && (
            <p role="status" className="text-label text-success">
              <span aria-hidden>✓ </span>Saved. Rebalance keeps locked assignments.
            </p>
          )}
        </div>
      )}
      {props.isProposal && (
        <p className="text-caption text-subtle">Accept the proposal to override or lock individual tasks.</p>
      )}
    </section>
  );
}

/** A breakdown component's 0–1 score as a short measured bar beside its number. */
function ScoreBar({ value }: { value: number }) {
  const w = useGrow(Math.min(1, Math.max(0, value)));
  return (
    <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-hover">
      <span
        className="block h-full rounded-full bg-muted transition-[width] duration-(--duration-slow) ease-emphasized"
        style={{ width: `${w * 100}%` }}
      />
    </span>
  );
}
