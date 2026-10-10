/**
 * S8 Plan (DESIGN §8). The accepted plan as a roadmap: milestones in order, with their tasks underneath.
 * Uses FAKE data from mocks/plan.ts + mocks/team.ts until the backend is connected.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Member, Milestone, Plan as PlanT, Task } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { fetchBoard, fetchPlan } from '../mocks/plan';
import { fetchMembers } from '../mocks/team';
import { MeasuredBar, Panel, clock, fmtHours } from './mission-control/shared';
import { MemberAvatar, STATUS_LABEL, StatusIcon } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, MockChip, PageHeader, Pill } from './page-states';

export function Plan() {
  // TODO: replace with api call. Each queryFn becomes `() => api('getPlan' | 'getBoard' | 'listMembers', …)`.
  const plan = useQuery({ queryKey: ['mock', 'plan'], queryFn: fetchPlan });
  const board = useQuery({ queryKey: ['mock', 'board'], queryFn: fetchBoard });
  const members = useQuery({ queryKey: ['mock', 'members'], queryFn: fetchMembers });

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader title="Plan" subtitle={plan.data?.payload.idea.pitch}>
        {plan.data && (
          <Pill tone={plan.data.status === 'accepted' ? 'success' : 'muted'}>
            v{plan.data.version} · {plan.data.status === 'accepted' ? 'Accepted' : 'Draft'}
          </Pill>
        )}
        <MockChip />
      </PageHeader>

      {plan.isError && <ErrorBox what="the plan" error={plan.error} onRetry={() => void plan.refetch()} />}
      {board.isError && (
        <ErrorBox what="milestones" error={board.error} onRetry={() => void board.refetch()} />
      )}

      {plan.isPending || board.isPending ? (
        <LoadingBlocks label="Loading plan" />
      ) : board.data ? (
        <>
          {plan.data && <PlanNumbers plan={plan.data} tasks={board.data.tasks} />}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <Roadmap
                milestones={board.data.milestones}
                tasks={board.data.tasks}
                members={members.data ?? []}
              />
            </div>
            <div className="min-w-0 space-y-4">{plan.data && <ScopeAndRisks plan={plan.data} />}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ----------------------------- top numbers ----------------------------- */

function Stat(props: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <p className="text-caption uppercase tracking-wide text-subtle">{props.label}</p>
      <p className="mt-1 font-display text-title text-strong">{props.value}</p>
      <p className="text-label text-subtle">{props.note}</p>
    </div>
  );
}

/** Estimated values get a "≈" and the word "estimated"; counted values don't (DESIGN §2.5). */
function PlanNumbers({ plan, tasks }: { plan: PlanT; tasks: Task[] }) {
  const f = plan.feasibility;
  const done = tasks.filter((t) => t.status === 'done').length;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Tasks done" value={`${done}/${tasks.length}`} note="Measured" />
      <Stat label="Work planned" value={`≈ ${fmtHours(f.requiredHours)}`} note="Estimated from task sizes" />
      <Stat
        label="Team capacity"
        value={`≈ ${fmtHours(f.availableEffectiveHours)}`}
        note="Estimated focus hours left"
      />
      <Stat
        label="Critical path"
        value={`≈ ${fmtHours(f.criticalPathHours)}`}
        note="Estimated longest chain"
      />
    </div>
  );
}

/* ----------------------------- roadmap ----------------------------- */

function Roadmap(props: { milestones: Milestone[]; tasks: Task[]; members: Member[] }) {
  if (props.milestones.length === 0) {
    return <EmptyBox message="No milestones yet. Accept a plan to turn it into milestones and tasks." />;
  }
  const sorted = [...props.milestones].sort((a, b) => a.ordinal - b.ordinal);
  const unscheduled = props.tasks.filter((t) => t.milestoneId === null);
  return (
    <>
      {sorted.map((m) => (
        <MilestoneCard
          key={m.id}
          title={`M${m.ordinal} · ${m.title}`}
          targetAt={m.targetAt}
          tasks={props.tasks.filter((t) => t.milestoneId === m.id)}
          members={props.members}
        />
      ))}
      {unscheduled.length > 0 && (
        <MilestoneCard title="No milestone" targetAt={null} tasks={unscheduled} members={props.members} />
      )}
    </>
  );
}

function MilestoneCard(props: { title: string; targetAt: string | null; tasks: Task[]; members: Member[] }) {
  const [open, setOpen] = useState(true);
  const done = props.tasks.filter((t) => t.status === 'done').length;
  const total = props.tasks.length;

  return (
    <section className="rounded-md border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-4 py-3 text-left hover:bg-hover"
      >
        <span aria-hidden className={cn('text-subtle transition-transform', open && 'rotate-90')}>
          ›
        </span>
        <h2 className="text-body font-medium text-strong">{props.title}</h2>
        {props.targetAt && <span className="text-label text-subtle">Due {clock(props.targetAt)}</span>}
        <span className="ml-auto text-label text-muted">
          {done}/{total} done
        </span>
        <div className="basis-full">
          <MeasuredBar
            value={total ? done / total : 0}
            label={`${props.title}: ${done} of ${total} tasks done`}
          />
        </div>
      </button>

      {open && (
        <ul className="border-t border-border">
          {props.tasks.length === 0 && (
            <li className="px-4 py-3 text-body text-subtle">No tasks in this milestone.</li>
          )}
          {props.tasks.map((t) => (
            <TaskRow key={t.id} task={t} member={props.members.find((m) => m.user.id === t.assigneeId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

const PRIORITY_LABEL = { must: 'Must', should: 'Should', could: 'Could' } as const;

/** One task line. Clicking it opens the task in the Tasks screen's inspector. */
function TaskRow({ task, member }: { task: Task; member: Member | undefined }) {
  const { wid = '' } = useParams();
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to={`/w/${wid}/tasks?task=${task.key}`}
        className="flex items-center gap-3 px-4 py-2 hover:bg-hover max-sm:flex-wrap"
      >
        <StatusIcon status={task.status} />
        <span className="w-12 shrink-0 font-mono text-label text-subtle">{task.key}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-body',
            task.status === 'done' ? 'text-muted line-through' : 'text-default',
          )}
        >
          {task.title}
        </span>
        <span className="w-20 shrink-0 text-label text-subtle max-sm:w-auto">
          {STATUS_LABEL[task.status]}
        </span>
        <Pill tone={task.priority === 'must' ? 'accent' : 'muted'}>{PRIORITY_LABEL[task.priority]}</Pill>
        <span className="w-10 shrink-0 text-right text-label text-subtle" title="Estimated hours">
          ≈{fmtHours(task.estimateHours)}
        </span>
        <MemberAvatar member={member} />
      </Link>
    </li>
  );
}

/* ----------------------------- side column ----------------------------- */

function ScopeAndRisks({ plan }: { plan: PlanT }) {
  const { scope } = plan.payload.outline;
  const tiers = [
    ['Must have', scope.must],
    ['Should have', scope.should],
    ['Could have', scope.could],
  ] as const;
  const warnings = plan.feasibility.issues;
  return (
    <>
      <Panel title="MVP scope" meta={plan.payload.idea.title}>
        <div className="space-y-3 px-4 py-3">
          {tiers.map(([label, items]) => (
            <div key={label}>
              <h3 className="text-caption uppercase tracking-wide text-subtle">{label}</h3>
              {items.length === 0 ? (
                <p className="text-body text-subtle">Nothing here.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-body text-default">
                  {items.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Risks" meta={warnings.length + plan.payload.outline.risks.length}>
        <ul className="space-y-2 px-4 py-3 text-body">
          {warnings.map((w) => (
            <li key={w.message} className="flex gap-2">
              <span aria-hidden className={w.severity === 'error' ? 'text-danger' : 'text-warning'}>
                ⚠
              </span>
              <span className="text-default">
                <span className="sr-only">{w.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
                {w.message}
              </span>
            </li>
          ))}
          {plan.payload.outline.risks.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-subtle">
                •
              </span>
              <span className="text-default">{r}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
