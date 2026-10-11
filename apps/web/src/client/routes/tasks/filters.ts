/**
 * S10 toolbar state, kept in the URL so views are shareable: `q` search, `who` assignees (ids, `none`),
 * `pri` priorities, `group` grouping, `sort`/`dir` for the list. Pure helpers, unit-tested.
 */
import type { Member, ScopeTier, Task, TaskStatus } from '@hakit/contracts';
import { keyNum, priorityRank, STATUS_ORDER } from './meta';

export type ListGroup = 'status' | 'person' | 'priority' | 'milestone' | 'none';
export type SortKey = 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'estimate' | 'updated';
export type SortDir = 'asc' | 'desc';

export type TaskFilters = { q: string; who: string[]; pri: ScopeTier[] };

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function readFilters(p: URLSearchParams): TaskFilters {
  return {
    q: p.get('q') ?? '',
    who: list(p.get('who')),
    pri: list(p.get('pri')).filter((x): x is ScopeTier => x === 'must' || x === 'should' || x === 'could'),
  };
}

export const activeFilterCount = (f: TaskFilters) => f.who.length + f.pri.length + (f.q.trim() ? 1 : 0);

/** Toggle one value of a comma-list param. */
export function toggleParam(p: URLSearchParams, name: string, value: string) {
  const cur = new Set(list(p.get(name)));
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  if (cur.size) p.set(name, [...cur].join(','));
  else p.delete(name);
  return p;
}

export function applyFilters(tasks: Task[], f: TaskFilters): Task[] {
  const q = f.q.trim().toLowerCase();
  const who = new Set(f.who);
  const pri = new Set(f.pri);
  return tasks.filter((t) => {
    if (who.size && !who.has(t.assigneeId ?? 'none')) return false;
    if (pri.size && !pri.has(t.priority)) return false;
    if (!q) return true;
    return (
      t.key.toLowerCase() === q ||
      t.key.toLowerCase().startsWith(q) ||
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.requiredSkills.some((s) => s.skillSlug.includes(q))
    );
  });
}

const statusRank = (s: TaskStatus) => STATUS_ORDER.indexOf(s);

export function sortTasks(tasks: Task[], key: SortKey, dir: SortDir, members: Member[]): Task[] {
  const name = (id: string | null) => {
    const m = id ? members.find((x) => x.user.id === id) : undefined;
    return m ? (m.user.name ?? m.user.githubLogin).toLowerCase() : '￿';
  };
  const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
    key: (a, b) => keyNum(a.key) - keyNum(b.key),
    title: (a, b) => a.title.localeCompare(b.title),
    status: (a, b) => statusRank(a.status) - statusRank(b.status),
    priority: (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
    assignee: (a, b) => name(a.assigneeId).localeCompare(name(b.assigneeId)),
    estimate: (a, b) => a.estimateHours - b.estimateHours,
    updated: (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => sign * cmp[key](a, b) || keyNum(a.key) - keyNum(b.key));
}

export const isSortKey = (v: string | null): v is SortKey =>
  v === 'key' ||
  v === 'title' ||
  v === 'status' ||
  v === 'priority' ||
  v === 'assignee' ||
  v === 'estimate' ||
  v === 'updated';

export const isListGroup = (v: string | null): v is ListGroup =>
  v === 'status' || v === 'person' || v === 'priority' || v === 'milestone' || v === 'none';
