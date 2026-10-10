/**
 * S10 data: board + members + activity, with optimistic create/update.
 * Live: edits go into the TanStack cache first, then to the API; a failed save is reverted.
 * getBoard failure surfaces as `loadError` (the screen shows an error state with retry); mock mode gets fixtures via the API.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Member, ProjectBoard, Task, TaskHistoryEntry, TaskStatus, UpdateTask } from '@hakit/contracts';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { STATUS_LABEL, type TaskLabel } from './meta';
import type { NewTaskInput } from './NewTaskDialog';
import type { HistoryEntry } from './TaskInspector';

/** Labels set by a person (persisted as `Task.labels`), keyed by task id. Beats the inferred label. */
export type LabelOverrides = Record<string, TaskLabel | null>;
export type TaskPatch = UpdateTask & { assigneeId?: string | null };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error');

/** Placeholder row shown until the server returns the real task (and its HK key). */
const who = (members: Member[], uid: string | null) => {
  const m = uid ? members.find((x) => x.user.id === uid) : undefined;
  return m ? (m.user.name ?? m.user.githubLogin) : 'Someone';
};

/** Server history row → the sentence the inspector shows. */
function describe(h: TaskHistoryEntry, members: Member[]): string {
  switch (h.kind) {
    case 'created':
      return 'created this';
    case 'status':
      return `moved this to ${STATUS_LABEL[h.toValue as TaskStatus] ?? h.toValue}`;
    case 'assignee':
      return h.toValue ? `assigned this to ${who(members, h.toValue)}` : 'unassigned this';
    case 'label':
      return h.toValue ? `set the label to ${h.toValue}` : 'removed the label';
    default:
      return `changed ${h.kind}`;
  }
}

function draftTask(input: NewTaskInput, existing: Task[], projectId: string): Task {
  const next = Math.max(0, ...existing.map((t) => Number(t.key.slice(3)) || 0)) + 1;
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
    labels: input.label ? [input.label] : [],
    startedAt: input.status === 'todo' ? null : now,
    completedAt: input.status === 'done' ? now : null,
    updatedAt: now,
  };
}

export function useTaskBoard(pid: string, wid: string, selectedKey?: string | null) {
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
  const [saveError, setSaveError] = useState<string | null>(null);

  const tasks = useMemo(() => (live ? board.data.tasks : []), [live, board.data]);
  const labels = useMemo<LabelOverrides>(
    () =>
      Object.fromEntries(tasks.filter((t) => t.labels?.length).map((t) => [t.id, t.labels![0] as TaskLabel])),
    [tasks],
  );
  const selectedId = selectedKey ? tasks.find((t) => t.key === selectedKey)?.id : undefined;
  const historyQ = useQuery({
    queryKey: qk('listTaskHistory', { tid: selectedId ?? '' }),
    queryFn: () => api('listTaskHistory', { params: { tid: selectedId! } }),
    enabled: live && !!selectedId,
  });
  const memberList = members.data ?? [];
  const history: Record<string, HistoryEntry[]> = selectedId
    ? {
        [selectedId]: (historyQ.data?.items ?? []).map((h) => ({
          id: h.id,
          ts: h.at,
          actor: who(memberList, h.actorUserId),
          text: describe(h, memberList),
        })),
      }
    : {};
  const refreshHistory = (tid: string) =>
    void qc.invalidateQueries({ queryKey: qk('listTaskHistory', { tid }) });

  /** Apply a change to whichever copy of the tasks is on screen. */
  const setTasks = useCallback(
    (fn: (ts: Task[]) => Task[]) => {
      qc.setQueryData<ProjectBoard>(qk('getBoard', { pid }), (b) => (b ? { ...b, tasks: fn(b.tasks) } : b));
    },
    [qc, pid],
  );
  const replace = (id: string, next: Task | ((t: Task) => Task)) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? (typeof next === 'function' ? next(t) : next) : t)));

  async function create(input: NewTaskInput) {
    const draft = draftTask(input, tasks, pid);
    setSaveError(null);
    setTasks((ts) => [...ts, draft]);
    if (!live) return;
    let saved: Task;
    try {
      // createTask has no status/assignee fields, so those follow as separate calls.
      saved = await api('createTask', {
        params: { pid },
        body: {
          title: input.title,
          description: input.description,
          milestoneId: null,
          priority: 'should',
          estimateHours: 2,
          requiredSkills: [],
          acceptanceCriteria: [],
          labels: input.label ? [input.label] : [],
        },
      });
    } catch (e) {
      setTasks((ts) => ts.filter((t) => t.id !== draft.id));
      setSaveError(`Couldn't create “${input.title}”: ${message(e)}`);
      return;
    }
    // The task exists on the server now: keep it on screen under its real id whatever happens next.
    replace(draft.id, saved);
    try {
      if (input.status !== saved.status) {
        saved = await api('updateTask', { params: { tid: saved.id }, body: { status: input.status } });
        replace(saved.id, saved);
      }
      if (input.assigneeId) {
        await api('manualAssign', {
          params: { tid: saved.id },
          body: { userId: input.assigneeId, lock: true },
        });
        const assigneeId = input.assigneeId;
        replace(saved.id, (t) => ({ ...t, assigneeId }));
      }
    } catch (e) {
      const created = saved;
      replace(created.id, created);
      setSaveError(`Created ${created.key}, but couldn't set its status/assignee: ${message(e)}`);
    }
  }

  async function update(id: string, patch: TaskPatch, _text?: string) {
    const before = tasks.find((t) => t.id === id);
    if (!before) return;
    setSaveError(null);
    replace(id, (t) => ({ ...t, ...patch, updatedAt: new Date().toISOString() }));
    const { assigneeId, ...fields } = patch;
    const unassign = 'assigneeId' in patch && !assigneeId;
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
      else if (unassign)
        await api('manualAssign', { params: { tid: id }, body: { userId: null, lock: false } });
      refreshHistory(id);
    } catch (e) {
      replace(id, before);
      setSaveError(`Couldn't save ${before.key}: ${message(e)}. Change undone.`);
    }
  }

  function setLabel(id: string, label: TaskLabel | null) {
    void update(id, { labels: label ? [label] : [] });
  }

  return {
    live,
    loading: board.isPending,
    loadError: board.isError ? message(board.error) : null,
    retry: () => void board.refetch(),
    tasks,
    dependencies: live ? board.data.dependencies : [],
    milestones: live ? board.data.milestones : [],
    members: memberList,
    activity: activity.data?.items ?? [],
    labels,
    history,
    saveError,
    clearSaveError: () => setSaveError(null),
    create,
    update,
    setLabel,
  };
}
