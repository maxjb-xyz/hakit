/** S10 quick-create (DESIGN §8 "Quick-create task (c)"). Native <dialog>: focus trap, Esc and scrim built in. */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Member, ScopeTier, TaskStatus } from '@hakit/contracts';
import { Button, Kbd } from '@hakit/ui';
import {
  LABELS,
  MemberAvatar,
  PRIORITIES,
  PRIORITY_LABEL,
  PriorityIcon,
  STATUS_LABEL,
  STATUSES,
  StatusIcon,
  type TaskLabel,
} from './meta';
import { Menu } from './Menu';

export type NewTaskInput = {
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  label: TaskLabel | null;
  priority: ScopeTier;
  estimateHours: number;
};

const EMPTY: NewTaskInput = {
  title: '',
  description: '',
  status: 'todo',
  assigneeId: null,
  label: null,
  priority: 'should',
  estimateHours: 2,
};

const chip = 'h-control-md rounded-full border border-border bg-surface px-2.5';

export function NewTaskDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewTaskInput) => void;
  members: Member[];
  initialStatus?: NewTaskInput['status'];
  initialAssignee?: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [form, setForm] = useState<NewTaskInput>(EMPTY);
  const [more, setMore] = useState(false);
  const set = <K extends keyof NewTaskInput>(k: K, v: NewTaskInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      setForm({
        ...EMPTY,
        status: props.initialStatus ?? EMPTY.status,
        assigneeId: props.initialAssignee ?? null,
      });
      setMore(false);
      d.showModal();
    } else if (!props.open && d.open) d.close();
  }, [props.open, props.initialStatus, props.initialAssignee]);

  const canCreate = form.title.trim().length > 0;
  const submit = (e?: FormEvent, keepOpen = false) => {
    e?.preventDefault();
    if (!canCreate) return;
    props.onCreate({ ...form, title: form.title.trim(), description: form.description.trim() });
    if (keepOpen && more) setForm((f) => ({ ...f, title: '', description: '' }));
    else props.onClose();
  };
  const assignee = props.members.find((m) => m.user.id === form.assigneeId);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={props.onClose}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      className="animate-pop-in m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-md border border-border-strong bg-raised p-0 text-default shadow-e3 backdrop:bg-canvas/70"
    >
      <form
        onSubmit={(e) => submit(e, true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(undefined, true);
        }}
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="rounded-xs border border-border px-1.5 font-mono text-caption text-subtle">
            HK
          </span>
          <h2 id={titleId} className="text-label text-muted">
            New task
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="interactive press ml-auto grid size-6 place-items-center rounded-sm text-subtle"
          >
            ✕
          </button>
        </div>

        <div className="px-4 pt-2">
          <label className="sr-only" htmlFor={`${titleId}-t`}>
            Title
          </label>
          <input
            id={`${titleId}-t`}
            autoFocus
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Task title"
            className="w-full rounded-xs bg-transparent text-title text-strong placeholder:text-disabled focus-visible:outline-none"
          />
          <label className="sr-only" htmlFor={`${titleId}-d`}>
            Description
          </label>
          <textarea
            id={`${titleId}-d`}
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Add a description…"
            className="mt-1 w-full resize-none rounded-xs bg-transparent text-body text-default placeholder:text-disabled focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <Menu
            label="Status"
            className={chip}
            value={form.status}
            onChange={(v) => set('status', v)}
            options={STATUSES.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
              icon: <StatusIcon status={s} />,
            }))}
          />
          <Menu
            label="Priority"
            className={chip}
            value={form.priority}
            onChange={(v) => set('priority', v)}
            options={PRIORITIES.map((p) => ({
              value: p,
              label: PRIORITY_LABEL[p],
              icon: <PriorityIcon priority={p} />,
            }))}
          />
          <Menu
            label="Assignee"
            className={chip}
            value={form.assigneeId ?? ''}
            onChange={(v) => set('assigneeId', v || null)}
            options={[
              {
                value: '',
                label: 'Unassigned',
                icon: <MemberAvatar member={undefined} size="xs" decorative />,
              },
              ...props.members.map((m) => ({
                value: m.user.id,
                label: m.user.name ?? m.user.githubLogin,
                icon: <MemberAvatar member={m} size="xs" decorative />,
              })),
            ]}
          >
            <MemberAvatar member={assignee} size="xs" decorative />
            <span className="truncate">
              {assignee ? (assignee.user.name ?? assignee.user.githubLogin) : 'Assignee'}
            </span>
          </Menu>
          <Menu
            label="Label"
            className={chip}
            value={form.label ?? ''}
            onChange={(v) => set('label', (v || null) as TaskLabel | null)}
            options={[{ value: '', label: 'No label' }, ...LABELS.map((l) => ({ value: l, label: l }))]}
          />
          <label className="flex h-control-md items-center gap-1.5 rounded-full border border-border bg-surface pr-1 pl-2.5 text-label text-subtle">
            Estimate
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={form.estimateHours}
              onChange={(e) => set('estimateHours', Math.min(24, Math.max(0, Number(e.target.value) || 0)))}
              className="field h-control-sm w-14 rounded-full px-2 text-right font-mono text-label"
            />
            <span aria-hidden>h</span>
            <span className="sr-only">hours, estimated</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-label text-subtle">
            <input
              type="checkbox"
              checked={more}
              onChange={(e) => setMore(e.target.checked)}
              className="size-3.5 accent-(--color-accent-500)"
            />
            Create more
          </label>
          <span className="flex items-center gap-1 text-caption text-subtle max-sm:hidden">
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!canCreate}>
            Create task
          </Button>
        </div>
      </form>
    </dialog>
  );
}
