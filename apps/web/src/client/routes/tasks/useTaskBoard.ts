/**
 * S10 data: board + members + activity, with optimistic create/update.
 * Live: edits go into the TanStack cache first, then to the API; a failed save is reverted.
 * Fallback (getBoard failed): fixture board in local state, edits are local only.
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectBoard, Task, UpdateTask } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import type { TaskLabel } from './meta';
import type { NewTaskInput } from './NewTaskDialog';
import type { HistoryEntry } from './TaskInspector';

/** Labels set by a person (not in the contract yet), keyed by task id. Beats the inferred label. */
export type LabelOverrides = Record<string, TaskLabel | null>;
export type TaskPatch = UpdateTask & { assigneeId?: string | null };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error');

/** Placeholder row shown until the server returns the real task (and its HK key). */
function draftTask(input: NewTaskInput, existing: Task[], projectId: string): Task {
  const next = Math.max(0, ...existing.map((t) => Number(t.key.slice(3)))) + 1;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId,
    key: `HK-${next}`,
    milestoneId: null,
    title: input.title,
    description: input.description,
    acceptanceCriteria: [],
    status: input.status,
    priority: 'should',
    estimateHours: 2,
    requiredSkills: [],
    source: 'manual',
    assigneeId: input.assigneeId,
    startedAt: input.status === 'todo' ? null : now,
    completedAt: input.status === 'done' ? now : null,
    updatedAt: now,
  };
}

export function useTaskBoard(pid: string, wid: string) {
  const qc = useQueryClient();
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });
  const activity = useQuery({
    queryKey: qk('listActivity', { pid }),
    queryFn: () => api('listActivity', { params: { pid } }),
    enabled: board.isSuccess,
  });

  const live = board.isSuccess;
  const [localTasks, setLocalTasks] = useState<Task[]>(fx.board.tasks);
  const [labels, setLabels] = useState<LabelOverrides>({});
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const tasks = live ? board.data.tasks : localTasks;

  /** Apply a change to whichever copy of the tasks is on screen. */
  const setTasks = useCallback(
    (fn: (ts: Task[]) => Task[]) => {
      if (live)
        qc.setQueryData<ProjectBoard>(qk('getBoard', { pid }), (b) => (b ? { ...b, tasks: fn(b.tasks) } : b));
      else setLocalTasks(fn);
    },
    [live, qc, pid],
  );
  const replace = (id: string, next: Task | ((t: Task) => Task)) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? (typeof next === 'function' ? next(t) : next) : t)));

  const note = (id: string, text: string) => {
    const entry = { id: crypto.randomUUID(), ts: new Date().toISOString(), text };
    setHistory((h) => ({ ...h, [id]: [...(h[id] ?? []), entry] }));
  };

  async function create(input: NewTaskInput) {
    const draft = draftTask(input, tasks, fx.board.projectId);
    setSaveError(null);
    setTasks((ts) => [...ts, draft]);
    setLabels((ls) => ({ ...ls, [draft.id]: input.label }));
    if (!live) return;
    try {
      // createTask has no status/assignee fields, so those follow as separate calls.
      let saved = await api('createTask', {
        params: { pid },
        body: {
          title: input.title,
          description: input.description,
          milestoneId: null,
          priority: 'should',
          estimateHours: 2,
          requiredSkills: [],
          acceptanceCriteria: [],
        },
      });
      if (input.status !== saved.status)
        saved = await api('updateTask', { params: { tid: saved.id }, body: { status: input.status } });
      if (input.assigneeId) {
        await api('manualAssign', {
          params: { tid: saved.id },
          body: { userId: input.assigneeId, lock: true },
        });
        saved = { ...saved, assigneeId: input.assigneeId };
      }
      replace(draft.id, saved);
      setLabels(({ [draft.id]: label = null, ...rest }) => ({ ...rest, [saved.id]: label }));
    } catch (e) {
      setTasks((ts) => ts.filter((t) => t.id !== draft.id));
      setSaveError(`Couldn't create “${input.title}”: ${message(e)}`);
    }
  }

  async function update(id: string, patch: TaskPatch, text?: string) {
    const before = tasks.find((t) => t.id === id);
    if (!before) return;
    setSaveError(null);
    replace(id, (t) => ({ ...t, ...patch, updatedAt: new Date().toISOString() }));
    const { assigneeId, ...fields } = patch;
    const unassign = 'assigneeId' in patch && !assigneeId;
    if (text) note(id, unassign && live ? `${text} (not saved: the API can't unassign yet)` : text);
    if (!live) return;
    try {
      if (Object.keys(fields).length > 0) {
        const saved = await api('updateTask', { params: { tid: id }, body: fields });
        // Take only server-computed fields; the rest already matches what we sent, and a
        // `board.changed` socket event refetches the full board anyway.
        replace(id, (t) => ({
          ...t,
          startedAt: saved.startedAt,
          completedAt: saved.completedAt,
          updatedAt: saved.updatedAt,
        }));
      }
      if (assigneeId)
        await api('manualAssign', { params: { tid: id }, body: { userId: assigneeId, lock: true } });
    } catch (e) {
      replace(id, before);
      setSaveError(`Couldn't save ${before.key}: ${message(e)}. Change undone.`);
    }
  }

  function setLabel(id: string, label: TaskLabel | null) {
    setLabels((ls) => ({ ...ls, [id]: label }));
    note(id, label ? `set the label to ${label}` : 'removed the label');
  }

  return {
    live,
    loading: board.isPending,
    loadError: board.isError ? message(board.error) : null,
    retry: () => void board.refetch(),
    tasks,
    dependencies: live ? board.data.dependencies : fx.board.dependencies,
    members: members.isSuccess ? members.data : fx.members,
    activity: live ? (activity.data?.items ?? []) : fx.activity,
    labels,
    history,
    saveError,
    clearSaveError: () => setSaveError(null),
    create,
    update,
    setLabel,
  };
}
