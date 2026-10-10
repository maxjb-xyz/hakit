/** S10 quick-create (DESIGN §8 "Quick-create task (c)"). Native <dialog>: focus trap, Esc and scrim built in. */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Member, TaskStatus } from '@hakit/contracts';
import { Button } from '@hakit/ui';
import { LABELS, Picker, STATUS_LABEL, STATUSES, type TaskLabel } from './meta';

export type NewTaskInput = {
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  label: TaskLabel | null;
};

const EMPTY: NewTaskInput = { title: '', description: '', status: 'todo', assigneeId: null, label: null };

export function NewTaskDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewTaskInput) => void;
  members: Member[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [form, setForm] = useState<NewTaskInput>(EMPTY);
  const set = <K extends keyof NewTaskInput>(k: K, v: NewTaskInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      setForm(EMPTY);
      d.showModal();
    } else if (!props.open && d.open) d.close();
  }, [props.open]);

  const canCreate = form.title.trim().length > 0;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canCreate) return;
    props.onCreate({ ...form, title: form.title.trim(), description: form.description.trim() });
    props.onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={props.onClose}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      className="m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-md border border-border bg-raised p-0 text-default shadow-e3 backdrop:bg-canvas/70"
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="rounded-xs border border-border px-1.5 font-mono text-caption text-subtle">
            HK
          </span>
          <h2 id={titleId} className="text-label text-muted">
            New task
          </h2>
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
            className="w-full bg-transparent text-title text-strong placeholder:text-disabled focus:outline-none"
          />
          <label className="sr-only" htmlFor={`${titleId}-d`}>
            Description
          </label>
          <textarea
            id={`${titleId}-d`}
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Add a description…"
            className="mt-1 w-full resize-none bg-transparent text-body text-default placeholder:text-disabled focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-2 px-4 pb-3">
          <Picker label="Status" value={form.status} onChange={(v) => set('status', v as TaskStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Picker>
          <Picker
            label="Assignee"
            value={form.assigneeId ?? ''}
            onChange={(v) => set('assigneeId', v || null)}
          >
            <option value="">Unassigned</option>
            {props.members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.name ?? m.user.githubLogin}
              </option>
            ))}
          </Picker>
          <Picker
            label="Label"
            value={form.label ?? ''}
            onChange={(v) => set('label', (v || null) as TaskLabel | null)}
          >
            <option value="">No label</option>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Picker>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <span className="mr-auto text-caption text-subtle max-sm:hidden">
            <kbd className="font-mono">⌘ Enter</kbd> to create
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
