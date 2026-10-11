/**
 * S10 task inspector (DESIGN §8): URL-driven (`?task=HK-12`) panel that slides in over the board.
 * Header: key, copy-branch, close. Properties (status, assignee, priority, estimate, label, skills), then
 * title/description, dependencies, assignment explanation, sub-tasks and a single activity timeline.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ActivityEvent, Assignment, Member, Task, TaskStatus } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import type { TaskPatch } from './useTaskBoard';
import { ago, memberName, taskHref, type Lookup } from '../mission-control/shared';
import {
  CriticalIcon,
  LABELS,
  LabelPill,
  LinkIcon,
  MemberAvatar,
  PRIORITIES,
  PRIORITY_LABEL,
  PriorityIcon,
  STATUS_LABEL,
  STATUSES,
  StatusIcon,
  prettySkill,
  type TaskLabel,
} from './meta';
import { Menu } from './Menu';

/** One row of the task's audit trail, as the inspector shows it. */
export type HistoryEntry = { id: string; ts: string; actor: string; actorId?: string | null; text: string };

/** Branch name that confirms the task↔code link (DESIGN §8 S10, AI.md §C.5). */
export const branchName = (t: Pick<Task, 'key' | 'title'>) =>
  `${t.key.toLowerCase()}-${t.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '')}`;

const VERB: Record<ActivityEvent['kind'], string> = {
  commit: 'committed',
  branch_created: 'created a branch',
  branch_deleted: 'deleted a branch',
  pr_opened: 'opened a PR',
  pr_updated: 'updated a PR',
  pr_merged: 'merged a PR',
  pr_closed: 'closed a PR',
  pr_review: 'reviewed a PR',
  agent_session_start: 'started an agent session',
  agent_active: 'has an agent working',
  agent_awaiting_input: 'has an agent waiting for input',
  agent_idle: 'has an idle agent',
  agent_error: 'has an agent that hit an error',
  agent_session_end: 'ended an agent session',
  task_status_changed: 'changed the status',
  assignment_changed: 'changed the assignment',
};

function Section(props: { title: string; meta?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-label font-medium text-muted">
        {props.title}
        {props.meta !== undefined && <span className="font-normal text-subtle">{props.meta}</span>}
        {props.action && <span className="ml-auto">{props.action}</span>}
      </h3>
      {props.children}
    </section>
  );
}

function Property(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-control-md items-center gap-3">
      <dt className="w-24 shrink-0 text-label text-subtle">{props.label}</dt>
      <dd className="flex min-w-0 flex-1 items-center text-label text-default">{props.children}</dd>
    </div>
  );
}

function CopyBranch({ task }: { task: Task }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const name = branchName(task);
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button
      size="sm"
      variant="ghost"
      title={name}
      onClick={() =>
        navigator.clipboard.writeText(name).then(
          () => setState('copied'),
          () => setState('failed'),
        )
      }
    >
      <span aria-live="polite">
        {state === 'copied' ? '✓ Copied' : state === 'failed' ? 'Copy failed' : 'Copy branch'}
      </span>
    </Button>
  );
}

function EstimateField(props: { value: number; onCommit: (h: number) => void; id: string }) {
  const [v, setV] = useState(String(props.value));
  const commit = () => {
    const n = Math.min(24, Math.max(0, Number(v)));
    if (!Number.isFinite(n) || v.trim() === '') return setV(String(props.value));
    if (n !== props.value) props.onCommit(n);
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        id={props.id}
        type="number"
        min={0}
        max={24}
        step={0.5}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="field h-control-sm w-16 rounded-sm px-2 text-right font-mono text-label"
      />
      <span className="text-subtle">hours · estimated</span>
    </span>
  );
}

function SubTasks(props: { items: string[]; onChange: (items: string[]) => void }) {
  // Done-state isn't in the contract (acceptanceCriteria is string[]), so ticks are local for now.
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    props.onChange([...props.items, v]);
    setDraft('');
  };
  const remove = (i: number) => {
    props.onChange(props.items.filter((_, j) => j !== i));
    setDone(new Set([...done].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };

  return (
    <Section
      title="Acceptance criteria"
      meta={props.items.length ? `${done.size}/${props.items.length} checked here` : undefined}
    >
      <ul className="space-y-0.5">
        {props.items.map((item, i) => (
          <li key={`${i}-${item}`} className="group flex items-center gap-2 rounded-sm px-1.5 hover:bg-hover">
            <input
              type="checkbox"
              id={`${inputId}-${i}`}
              checked={done.has(i)}
              onChange={() => {
                const next = new Set(done);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                setDone(next);
              }}
              className="size-3.5 accent-(--color-accent-400)"
            />
            <label
              htmlFor={`${inputId}-${i}`}
              className={cn('flex-1 py-1 text-body text-default', done.has(i) && 'text-subtle line-through')}
            >
              {item}
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove: ${item}`}
              className="interactive grid size-6 place-items-center rounded-sm text-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor={`${inputId}-new`} className="sr-only">
        Add acceptance criterion
      </label>
      <input
        id={`${inputId}-new`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="+ Add a criterion and press Enter"
        className="mt-1 h-control-md w-full rounded-sm border border-transparent bg-transparent px-1.5 text-body text-default placeholder:text-subtle hover:bg-hover focus-visible:border-border-strong focus-visible:bg-sunken focus-visible:outline-none"
      />
    </Section>
  );
}

function DepRow({ task, kind }: { task: Task; kind: 'blocks' | 'soft' }) {
  const open = task.status !== 'done' && task.status !== 'cut';
  return (
    <li className="row-interactive flex h-control-lg items-center gap-2 rounded-sm px-2">
      <StatusIcon status={task.status} />
      <span className="sr-only">{STATUS_LABEL[task.status]}:</span>
      <span className="font-mono text-caption text-faint">{task.key}</span>
      <Link to={taskHref(task.key)} className="row-link min-w-0 flex-1 truncate text-body text-default">
        {task.title}
      </Link>
      {kind === 'soft' && <span className="text-caption text-subtle">soft</span>}
      {kind === 'blocks' && open && <span className="text-caption text-subtle">open</span>}
    </li>
  );
}

function Dependencies(props: {
  blockedBy: { task: Task; kind: 'blocks' | 'soft' }[];
  blocking: { task: Task; kind: 'blocks' | 'soft' }[];
}) {
  const waiting = props.blockedBy.filter(
    (d) => d.kind === 'blocks' && d.task.status !== 'done' && d.task.status !== 'cut',
  ).length;
  return (
    <Section title="Dependencies" meta={props.blockedBy.length + props.blocking.length || undefined}>
      {props.blockedBy.length + props.blocking.length === 0 ? (
        <p className="text-body text-subtle">No dependencies. This task can start any time.</p>
      ) : (
        <div className="space-y-3">
          {props.blockedBy.length > 0 && (
            <div>
              <p
                className={cn(
                  'mb-1 flex items-center gap-1.5 text-label',
                  waiting ? 'text-danger' : 'text-subtle',
                )}
              >
                <LinkIcon className="size-3" />
                {waiting ? `Waiting on ${waiting}` : 'Depends on (all done)'}
              </p>
              <ul>
                {props.blockedBy.map((d) => (
                  <DepRow key={d.task.id} {...d} />
                ))}
              </ul>
            </div>
          )}
          {props.blocking.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-label text-subtle">
                <LinkIcon className="size-3" />
                Blocks
              </p>
              <ul>
                {props.blocking.map((d) => (
                  <DepRow key={d.task.id} {...d} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function Why(props: { assignment: Assignment | undefined; lookup: Lookup }) {
  const a = props.assignment;
  if (!a) {
    return (
      <Section title="Why this assignee">
        <p className="text-body text-subtle">
          No active assignment. Run Assign on the Plan screen, or pick someone above.
        </p>
      </Section>
    );
  }
  const alts = a.alternatives.slice(0, 2);
  return (
    <Section
      title="Why this assignee"
      meta={a.source === 'manual' ? 'manual pick' : a.locked ? 'solver · locked' : 'solver'}
    >
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="text-body text-default">{a.explanation}</p>
        <p className="mt-1 text-caption text-subtle">
          Score {a.score.toFixed(2)} (computed)
          {a.explanationSource === 'ai' ? ' · wording polished by AI' : ''}
        </p>
        {alts.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border pt-2">
            {alts.map((alt) => {
              const m = props.lookup.member(alt.userId);
              return (
                <li key={alt.userId} className="flex items-center gap-2 text-label text-muted">
                  <MemberAvatar member={m} size="xs" decorative />
                  <span className="text-default">{memberName(m)}</span>
                  <span className="ml-auto font-mono text-subtle">
                    {alt.delta >= 0 ? '+' : '−'}
                    {Math.abs(alt.delta).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

type TimelineRow = { id: string; ts: string; node: ReactNode };

function Activity(props: {
  task: Task;
  events: ActivityEvent[];
  history: HistoryEntry[];
  loading: boolean;
  lookup: Lookup;
}) {
  const rows: TimelineRow[] = [
    ...props.events.map((e) => {
      const m = props.lookup.member(e.actorUserId);
      const who = m ? memberName(m) : (e.actorRaw ?? 'Someone');
      const body = (
        <>
          <span className="font-medium text-default">{who}</span> {VERB[e.kind]}
          {e.prNumber !== null && <span className="font-mono text-subtle"> #{e.prNumber}</span>}
        </>
      );
      return {
        id: e.id,
        ts: e.ts,
        node: (
          <>
            <MemberAvatar member={m} size="xs" decorative className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-label text-muted">
                {body}
                <span className="text-subtle"> · {ago(e.ts, props.lookup.now)}</span>
              </p>
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group/a mt-0.5 flex min-w-0 items-center gap-1 rounded-xs text-body text-default hover:text-strong"
                >
                  <span className="truncate underline decoration-border-strong underline-offset-2 group-hover/a:decoration-default">
                    {e.title}
                  </span>
                  <span aria-hidden className="text-subtle">
                    ↗
                  </span>
                  <span className="sr-only">(opens GitHub in a new tab)</span>
                </a>
              ) : (
                <p className="mt-0.5 truncate text-body text-default">{e.title}</p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-caption">
                <span
                  className={cn(
                    'rounded-full border px-1.5',
                    e.linkKind === 'confirmed'
                      ? 'border-border-strong text-muted'
                      : 'border-dashed border-border-strong text-subtle',
                  )}
                  title={
                    e.linkKind === 'confirmed'
                      ? 'Linked by branch name or PR reference'
                      : `Inferred link${e.linkConfidence !== null ? ` (${Math.round(e.linkConfidence * 100)}% confident)` : ''}`
                  }
                >
                  {e.linkKind === 'confirmed'
                    ? '✓ Confirmed link'
                    : `Inferred${e.linkConfidence !== null ? ` ${Math.round(e.linkConfidence * 100)}%` : ''}`}
                </span>
                {e.ref && <span className="truncate font-mono text-subtle">{e.ref}</span>}
                {e.additions !== null && (
                  <span className="font-mono">
                    <span className="text-success">+{e.additions}</span>{' '}
                    <span className="text-danger">−{e.deletions ?? 0}</span>
                  </span>
                )}
              </p>
            </div>
          </>
        ),
      };
    }),
    ...props.history.map((h) => ({
      id: h.id,
      ts: h.ts,
      node: (
        <>
          <MemberAvatar
            member={props.lookup.member(h.actorId ?? null)}
            size="xs"
            decorative
            className="mt-0.5"
          />
          <p className="min-w-0 flex-1 text-label text-muted">
            <span className="font-medium text-default">{h.actor}</span> {h.text}
            <span className="text-subtle"> · {ago(h.ts, props.lookup.now)}</span>
          </p>
        </>
      ),
    })),
  ].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  return (
    <Section title="Activity" meta={rows.length || undefined}>
      <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-2 before:w-px before:bg-border">
        {props.loading && rows.length === 0 && (
          <li className="flex items-center gap-3" aria-label="Loading history">
            <span className="skeleton size-4 rounded-full" />
            <span className="skeleton h-3 w-48 rounded-xs" />
          </li>
        )}
        {rows.map((r, i) => (
          <li
            key={r.id}
            style={{ '--i': i } as React.CSSProperties}
            className="animate-list-in relative flex gap-3"
          >
            {r.node}
          </li>
        ))}
        <li className="relative flex items-center gap-3 text-label text-subtle">
          <span aria-hidden className="grid size-4 place-items-center">
            <span className="size-1.5 rounded-full bg-border-strong" />
          </span>
          {props.task.source === 'plan'
            ? 'Created from the accepted plan'
            : props.task.source === 'recommendation'
              ? 'Created from a recommendation'
              : 'Created manually'}
        </li>
      </ol>
      {props.events.length === 0 && (
        <p className="mt-3 text-label text-subtle">
          No linked commits or PRs yet. Push to the copied branch name and they'll link here (confirmed).
        </p>
      )}
    </Section>
  );
}

export function TaskInspector(props: {
  taskKey: string;
  task: Task | undefined;
  members: Member[];
  lookup: Lookup;
  label: TaskLabel | null;
  labelInferred: boolean;
  critical: boolean;
  assignment: Assignment | undefined;
  blockedBy: { task: Task; kind: 'blocks' | 'soft' }[];
  blocking: { task: Task; kind: 'blocks' | 'soft' }[];
  events: ActivityEvent[];
  history: HistoryEntry[];
  historyLoading: boolean;
  onUpdate: (patch: TaskPatch, note?: string) => void;
  onLabel: (label: TaskLabel | null) => void;
  onClose: () => void;
}) {
  const { task } = props;
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');

  // Move focus into the panel when it opens or switches task, so keyboard users land here.
  useEffect(() => {
    headingRef.current?.focus();
  }, [task?.id]);

  // Esc closes (unless a modal dialog or a menu is open on top and should get it).
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open], [role="listbox"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const frame =
    'animate-slide-in-right fixed top-14 right-2.5 bottom-2.5 z-20 flex w-full max-w-(--spacing-inspector) flex-col rounded-r-md border-l border-border bg-canvas shadow-e3 max-md:inset-x-0 max-md:top-0 max-md:bottom-14 max-md:max-w-none max-md:rounded-none';

  const closeBtn = (
    <button
      type="button"
      onClick={props.onClose}
      aria-label="Close task"
      title="Close (Esc)"
      className="interactive press grid size-7 place-items-center rounded-sm text-subtle"
    >
      ✕
    </button>
  );

  if (!task) {
    return (
      <aside aria-labelledby={headingId} className={frame}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-mono text-label text-subtle">
            {props.taskKey}
          </h2>
          <span className="ml-auto">{closeBtn}</span>
        </div>
        <div className="p-6">
          <p className="text-body text-default">
            This task doesn't exist, was deleted, or is hidden by filters.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={props.onClose}>
            Back to tasks
          </Button>
        </div>
      </aside>
    );
  }

  const commitTitle = () => {
    const v = title.trim();
    if (!v) setTitle(task.title);
    else if (v !== task.title) props.onUpdate({ title: v }, `renamed this to “${v}”`);
  };
  const commitDescription = () => {
    if (description.trim() !== task.description)
      props.onUpdate({ description: description.trim() }, 'edited the description');
  };
  const assignee = props.lookup.member(task.assigneeId);
  const chip = 'h-control-md -ml-1.5 px-1.5';

  return (
    <aside aria-labelledby={headingId} className={frame}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <StatusIcon status={task.status} />
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-mono text-label text-muted focus:outline-none"
        >
          {task.key}
          <span className="sr-only">: {task.title}</span>
        </h2>
        {props.critical && task.status !== 'done' && (
          <span className="flex items-center gap-1 text-caption text-strong">
            <CriticalIcon className="size-3" />
            Critical path
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <CopyBranch task={task} />
          {closeBtn}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="px-5 pt-4 max-sm:px-4">
          <label htmlFor={`${headingId}-title`} className="sr-only">
            Title
          </label>
          <textarea
            id={`${headingId}-title`}
            value={title}
            rows={1}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="field-sizing-content -mx-1.5 w-[calc(100%+0.75rem)] resize-none rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-title font-semibold text-strong hover:bg-hover focus-visible:border-border-strong focus-visible:bg-sunken focus-visible:outline-none"
          />
          <label htmlFor={`${headingId}-desc`} className="sr-only">
            Description
          </label>
          <textarea
            id={`${headingId}-desc`}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
            placeholder="Add a description…"
            className="field-sizing-content -mx-1.5 mt-1 min-h-16 w-[calc(100%+0.75rem)] resize-none rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-body text-default placeholder:text-subtle hover:bg-hover focus-visible:border-border-strong focus-visible:bg-sunken focus-visible:outline-none"
          />
        </div>

        <dl className="mx-5 mt-3 flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2 max-sm:mx-4">
          <Property label="Status">
            <Menu
              label="Status"
              className={chip}
              value={task.status}
              onChange={(status: TaskStatus) =>
                props.onUpdate({ status }, `moved this to ${STATUS_LABEL[status]}`)
              }
              options={(STATUSES.includes(task.status) ? STATUSES : [...STATUSES, task.status]).map((s) => ({
                value: s,
                label: STATUS_LABEL[s],
                icon: <StatusIcon status={s} />,
              }))}
            />
          </Property>
          <Property label="Assignee">
            <Menu
              label="Assignee"
              className={chip}
              value={task.assigneeId ?? ''}
              onChange={(v) => {
                const id = v || null;
                props.onUpdate(
                  { assigneeId: id },
                  id ? `assigned this to ${memberName(props.lookup.member(id))}` : 'unassigned this',
                );
              }}
              options={[
                {
                  value: '',
                  label: 'Unassigned',
                  icon: <MemberAvatar member={undefined} size="xs" decorative />,
                },
                ...props.members.map((m) => ({
                  value: m.user.id,
                  label: memberName(m),
                  icon: <MemberAvatar member={m} size="xs" decorative />,
                })),
              ]}
            >
              <MemberAvatar member={assignee} size="xs" decorative />
              <span className={cn('truncate', !assignee && 'text-subtle')}>{memberName(assignee)}</span>
            </Menu>
          </Property>
          <Property label="Priority">
            <Menu
              label="Priority"
              className={chip}
              value={task.priority}
              onChange={(p) => props.onUpdate({ priority: p }, `set priority to ${PRIORITY_LABEL[p]}`)}
              options={PRIORITIES.map((p) => ({
                value: p,
                label: PRIORITY_LABEL[p],
                icon: <PriorityIcon priority={p} />,
              }))}
            />
          </Property>
          <Property label="Estimate">
            <label htmlFor={`${headingId}-est`} className="sr-only">
              Estimate in hours
            </label>
            <EstimateField
              key={task.estimateHours}
              id={`${headingId}-est`}
              value={task.estimateHours}
              onCommit={(h) => props.onUpdate({ estimateHours: h }, `estimated ${h}h`)}
            />
          </Property>
          <Property label="Label">
            <Menu
              label="Label"
              className={chip}
              value={props.labelInferred ? '' : (props.label ?? '')}
              onChange={(v) => props.onLabel((v || null) as TaskLabel | null)}
              options={[{ value: '', label: 'No label' }, ...LABELS.map((l) => ({ value: l, label: l }))]}
            >
              {props.label ? (
                <LabelPill label={props.label} inferred={props.labelInferred} />
              ) : (
                <span className="text-subtle">No label</span>
              )}
              {props.label && props.labelInferred && (
                <span className="text-caption text-subtle">inferred</span>
              )}
            </Menu>
          </Property>
          <Property label="Skills">
            {task.requiredSkills.length === 0 ? (
              <span className="text-subtle">None required</span>
            ) : (
              <span className="flex flex-wrap gap-1 py-1">
                {task.requiredSkills.map((s) => (
                  <span
                    key={s.skillSlug}
                    className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-caption text-muted"
                  >
                    {prettySkill(s.skillSlug)} <span className="text-faint">L{s.level}</span>
                  </span>
                ))}
              </span>
            )}
          </Property>
          <Property label="Updated">
            <span className="text-muted">{ago(task.updatedAt, props.lookup.now)}</span>
          </Property>
        </dl>

        <div className="px-5 pb-8 max-sm:px-4">
          <Dependencies blockedBy={props.blockedBy} blocking={props.blocking} />
          <Why assignment={props.assignment} lookup={props.lookup} />
          <SubTasks
            items={task.acceptanceCriteria}
            onChange={(items) =>
              props.onUpdate(
                { acceptanceCriteria: items },
                items.length > task.acceptanceCriteria.length ? 'added a criterion' : 'removed a criterion',
              )
            }
          />
          <Activity
            task={task}
            events={props.events}
            history={props.history}
            loading={props.historyLoading}
            lookup={props.lookup}
          />
        </div>
      </div>
    </aside>
  );
}
