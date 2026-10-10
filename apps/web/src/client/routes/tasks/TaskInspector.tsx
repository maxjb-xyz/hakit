/**
 * S10 task inspector (DESIGN §8): URL-driven (`?task=HK-12`) peek panel over the task list.
 * Main column: title, description, sub-tasks (acceptance criteria), activity. Side column: properties.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ActivityEvent, Member, Task, TaskStatus } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { ActivityItem } from '../mission-control/ActivityFeed';
import type { TaskPatch } from './useTaskBoard';
import { ago, fmtHours, memberName, type Lookup } from '../mission-control/shared';
import {
  LABELS,
  LabelPill,
  MemberAvatar,
  Picker,
  STATUS_LABEL,
  STATUSES,
  StatusIcon,
  type TaskLabel,
} from './meta';

/** A change made in this session, shown in the activity list until the API records it. */
export type HistoryEntry = { id: string; ts: string; actor: string; text: string };

/** Branch name that confirms the task↔code link (DESIGN §8 S10, AI.md §C.5). */
export const branchName = (t: Pick<Task, 'key' | 'title'>) =>
  `${t.key.toLowerCase()}-${t.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '')}`;

function Section(props: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="mb-2 flex items-center gap-2 text-label font-medium text-muted">
        {props.title}
        {props.meta !== undefined && <span className="text-subtle">{props.meta}</span>}
      </h3>
      {props.children}
    </section>
  );
}

function Property(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-control-md items-center gap-3 max-md:flex-1 max-md:basis-40">
      <dt className="w-28 shrink-0 text-label text-subtle">{props.label}</dt>
      <dd className="min-w-0 text-label text-default">{props.children}</dd>
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
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy branch name'}
      </span>
    </Button>
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
    <Section title="Sub-tasks" meta={props.items.length ? `${done.size}/${props.items.length}` : undefined}>
      {props.items.length === 0 && <p className="mb-2 text-body text-subtle">No sub-tasks yet.</p>}
      <ul className="space-y-0.5">
        {props.items.map((item, i) => (
          <li key={`${i}-${item}`} className="group flex items-center gap-2 rounded-xs px-1 hover:bg-hover">
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
              className="size-3.5 accent-(--color-accent-500)"
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
              aria-label={`Remove sub-task: ${item}`}
              className="rounded-xs px-1 text-subtle opacity-0 group-hover:opacity-100 hover:text-default focus-visible:opacity-100"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor={`${inputId}-new`} className="sr-only">
        Add sub-task
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
        placeholder="+ Add sub-task and press Enter"
        className="mt-1 h-control-md w-full rounded-xs bg-transparent px-1 text-body text-default placeholder:text-subtle hover:bg-hover focus:bg-hover"
      />
    </Section>
  );
}

function Activity(props: { task: Task; events: ActivityEvent[]; history: HistoryEntry[]; lookup: Lookup }) {
  const rows = [
    ...props.events.map((e) => ({
      ts: e.ts,
      node: <ActivityItem key={e.id} e={e} lookup={props.lookup} showTask={false} />,
    })),
    ...props.history.map((h) => ({
      ts: h.ts,
      node: (
        <li key={h.id} className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
          <span aria-hidden className="grid size-5 place-items-center text-subtle">
            •
          </span>
          <p className="text-label text-muted">
            <span className="text-default">{h.actor}</span> {h.text}
            <span className="text-subtle"> · {ago(h.ts, props.lookup.now)}</span>
          </p>
        </li>
      ),
    })),
  ].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  return (
    <Section title="Activity" meta={rows.length || undefined}>
      <ul className="rounded-sm border border-border">
        {rows.map((r) => r.node)}
        <li className="px-4 py-2 text-label text-subtle">
          {props.task.source === 'plan'
            ? 'Created from the accepted plan'
            : props.task.source === 'recommendation'
              ? 'Created from a recommendation'
              : 'Created manually'}
        </li>
      </ul>
      {props.events.length === 0 && (
        <p className="mt-2 text-label text-subtle">
          No linked commits yet. Use the branch name above so pushes link here automatically.
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
  events: ActivityEvent[];
  history: HistoryEntry[];
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

  // Esc closes (unless a modal dialog is open on top and should get it).
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const frame =
    'fixed top-14 right-2.5 bottom-2.5 z-20 flex w-full max-w-(--spacing-inspector) flex-col rounded-r-md border-l border-hover bg-canvas max-md:inset-x-0 max-md:top-0 max-md:bottom-14 max-md:max-w-none max-md:rounded-none';

  if (!task) {
    return (
      <aside aria-labelledby={headingId} className={frame}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-mono text-label text-subtle">
            {props.taskKey}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={props.onClose}
            aria-label="Close task"
          >
            ✕
          </Button>
        </div>
        <p className="p-6 text-body text-muted">This task doesn't exist or was deleted.</p>
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
        <div className="ml-auto flex items-center gap-1">
          <CopyBranch task={task} />
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onClose}
            aria-label="Close task"
            title="Close (Esc)"
          >
            ✕
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="px-6 py-5 max-sm:px-4">
          <label htmlFor={`${headingId}-title`} className="sr-only">
            Title
          </label>
          <input
            id={`${headingId}-title`}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full rounded-xs bg-transparent text-title font-semibold text-strong hover:bg-hover focus:bg-hover"
          />
          <label htmlFor={`${headingId}-desc`} className="sr-only">
            Description
          </label>
          <textarea
            id={`${headingId}-desc`}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
            placeholder="Add a description…"
            className="mt-2 w-full resize-y rounded-xs bg-transparent text-body-lg text-default placeholder:text-subtle hover:bg-hover focus:bg-hover"
          />

          <SubTasks
            items={task.acceptanceCriteria}
            onChange={(items) =>
              props.onUpdate(
                { acceptanceCriteria: items },
                items.length > task.acceptanceCriteria.length ? 'added a sub-task' : 'removed a sub-task',
              )
            }
          />
          <Activity task={task} events={props.events} history={props.history} lookup={props.lookup} />
        </div>

        <dl className="order-first flex flex-col gap-1 border-b border-hover px-6 py-4 max-sm:px-4">
          <Property label="Status">
            <Picker
              label="Status"
              value={task.status}
              onChange={(v) => {
                const status = v as TaskStatus;
                props.onUpdate({ status }, `moved this to ${STATUS_LABEL[status]}`);
              }}
            >
              {(STATUSES.includes(task.status) ? STATUSES : [...STATUSES, task.status]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Picker>
          </Property>
          <Property label="Assignee">
            <span className="flex items-center gap-2">
              <MemberAvatar member={assignee} />
              <Picker
                label="Assignee"
                value={task.assigneeId ?? ''}
                onChange={(v) => {
                  const id = v || null;
                  props.onUpdate(
                    { assigneeId: id },
                    id ? `assigned this to ${memberName(props.lookup.member(id))}` : 'unassigned this',
                  );
                }}
              >
                <option value="">Unassigned</option>
                {props.members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {memberName(m)}
                  </option>
                ))}
              </Picker>
            </span>
          </Property>
          <Property label="Label">
            <span className="flex flex-col items-start gap-1">
              <Picker
                label="Label"
                value={props.label ?? ''}
                onChange={(v) => props.onLabel((v || null) as TaskLabel | null)}
              >
                <option value="">No label</option>
                {LABELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Picker>
              {!props.labelInferred && (
                <span className="text-caption text-subtle">Not saved yet: labels aren't in the API</span>
              )}
              {props.label && props.labelInferred && (
                <span className="flex items-center gap-1 text-caption text-subtle">
                  <LabelPill label={props.label} inferred /> from skills
                </span>
              )}
            </span>
          </Property>

          <div className="my-2 border-t border-border max-md:hidden" />

          <Property label="Priority">
            <span className="capitalize">{task.priority}</span>
          </Property>
          <Property label="Estimate">
            <span title="Estimated hours">≈{fmtHours(task.estimateHours)}</span>
          </Property>
          <Property label="Skills">
            {task.requiredSkills.length === 0 ? (
              <span className="text-subtle">None</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {task.requiredSkills.map((s) => (
                  <span
                    key={s.skillSlug}
                    className="rounded-xs border border-border px-1.5 font-mono text-caption text-muted"
                  >
                    {s.skillSlug} · L{s.level}
                  </span>
                ))}
              </span>
            )}
          </Property>
          <Property label="Updated">
            <span className="text-muted">{ago(task.updatedAt, props.lookup.now)}</span>
          </Property>
        </dl>
      </div>
    </aside>
  );
}
