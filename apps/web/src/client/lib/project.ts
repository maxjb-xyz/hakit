/**
 * Which project the workspace screens show. One hook, used everywhere a screen needs a `pid`:
 *   const { pid, project, projects } = useProject(wid);
 * Resolution order: `?project=` in the URL, the project last picked in this browser for the workspace,
 * the workspace's active project, then its newest one. `pid` is null while loading or when there is none.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@hakit/contracts';
import { api } from './api';
import { qk } from './query';

const storageKey = (wid: string) => `hakit.project.${wid}`;
const listeners = new Set<() => void>();

function readChoice(wid: string): string | null {
  try {
    return localStorage.getItem(storageKey(wid));
  } catch {
    return null;
  }
}

function writeChoice(wid: string, pid: string) {
  try {
    localStorage.setItem(storageKey(wid), pid);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Pure resolution rule (exported for tests). */
export function resolveProject(projects: Project[], ...preferred: (string | null | undefined)[]) {
  for (const id of preferred) {
    const hit = id ? projects.find((p) => p.id === id) : undefined;
    if (hit) return hit;
  }
  const newest = [...projects].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return newest.find((p) => p.status === 'active') ?? newest[0] ?? null;
}

export function useProject(wid: string) {
  const [search, setSearch] = useSearchParams();
  const projects = useQuery({
    queryKey: qk('listProjects', { wid }),
    queryFn: () => api('listProjects', { params: { wid } }),
    enabled: !!wid,
  });
  const stored = useSyncExternalStore(
    subscribe,
    () => readChoice(wid),
    () => null,
  );
  const project = projects.data ? resolveProject(projects.data, search.get('project'), stored) : null;
  const select = useCallback(
    (pid: string) => {
      writeChoice(wid, pid);
      // An explicit pick replaces a project pinned by the URL.
      setSearch(
        (s) => {
          if (!s.has('project')) return s;
          const next = new URLSearchParams(s);
          next.delete('project');
          return next;
        },
        { replace: true },
      );
    },
    [wid, setSearch],
  );
  return {
    pid: project?.id ?? null,
    project,
    projects: projects.data ?? [],
    query: projects,
    select,
  };
}
