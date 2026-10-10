/**
 * Top-bar project crumb (DESIGN §6: "Workspace ▸ Project"). A plain label with one project, a native select
 * when the workspace has several; the choice is shared by every screen through `useProject`.
 */
import { useId } from 'react';
import { useProject } from '../lib/project';

export function ProjectSwitcher({ wid }: { wid: string }) {
  const id = useId();
  const { project, projects, select } = useProject(wid);
  if (!project) return null;
  return (
    <>
      <span aria-hidden className="text-faint">
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
