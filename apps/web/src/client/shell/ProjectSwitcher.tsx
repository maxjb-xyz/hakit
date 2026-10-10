/**
 * Top-bar project crumb (DESIGN §6: "Workspace ▸ Project"). A plain label with one project, a native select
 * when the workspace has several; the choice is shared by every screen through `useProject`.
 */
import { useId } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { qk } from '../lib/query';

const NEW_WORKSPACE = '__new';

/**
 * Top-bar workspace crumb: switches between the member's workspaces and offers "New workspace…" (S2, `/new`).
 * A plain label until `me` loads.
 */
export function WorkspaceSwitcher({ wid, name }: { wid: string; name: string | undefined }) {
  const id = useId();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const memberships = me.data?.memberships ?? [];
  if (!memberships.length)
    return <span className="min-w-0 truncate text-body text-subtle">{name ?? '…'}</span>;
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Workspace
      </label>
      <select
        id={id}
        value={wid}
        onChange={(e) => navigate(e.target.value === NEW_WORKSPACE ? '/new' : `/w/${e.target.value}/mc`)}
        className="h-control-sm max-w-40 min-w-0 truncate rounded-xs border border-border bg-transparent px-1.5 text-body text-subtle hover:text-strong"
      >
        {memberships.map((m) => (
          <option key={m.workspaceId} value={m.workspaceId}>
            {m.workspaceName}
          </option>
        ))}
        <option value={NEW_WORKSPACE}>New workspace…</option>
      </select>
    </>
  );
}

export function ProjectSwitcher({ wid }: { wid: string }) {
  const id = useId();
  const { project, projects, select } = useProject(wid);
  if (!project) return null;
  return (
    <>
      <span aria-hidden className="text-faint max-sm:hidden">
        ›
      </span>
      {projects.length > 1 ? (
        <>
          <label htmlFor={id} className="sr-only">
            Project
          </label>
          <select
            id={id}
            value={project.id}
            onChange={(e) => select(e.target.value)}
            className="h-control-sm max-w-xs truncate rounded-xs border border-border bg-transparent px-1.5 text-body text-subtle hover:text-strong"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className="max-w-xs truncate text-body text-subtle">{project.name}</span>
      )}
    </>
  );
}
