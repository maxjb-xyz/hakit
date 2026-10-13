/**
 * S14 Settings › Your data and Danger zone (self-hosted privacy controls).
 * - Export my data: `exportMe`, saved as a JSON file. It never contains tokens or session ids.
 * - Delete my account: `deleteMe` after typing your GitHub login; a sole owner of a team gets the server's 409
 *   message (transfer or delete the workspace first). Afterwards → /login.
 * - Delete workspace (owners): `deleteWorkspace` after typing the workspace name exactly. Afterwards → /.
 */
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { Panel } from '../mission-control/shared';
import { ErrorBox, LoadingBlocks } from '../page-states';

const input =
  'field mt-1 h-control-md w-full max-w-md rounded-sm px-3 text-body text-strong placeholder:text-subtle';

function saveJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/* -------------------------------- Your data -------------------------------- */

export function YourDataPanel() {
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  return (
    <div className="space-y-4">
      <ExportPanel />
      <Panel title="Delete my account">
        <div className="p-4">
          {me.isPending ? (
            <LoadingBlocks label="Loading your account" rows={1} />
          ) : me.isError ? (
            <ErrorBox what="your account" error={me.error} onRetry={() => void me.refetch()} />
          ) : (
            <DeleteAccount login={me.data.user.githubLogin} />
          )}
        </div>
      </Panel>
    </div>
  );
}

function ExportPanel() {
  const [done, setDone] = useState(false);
  const exp = useMutation({
    mutationFn: () => api('exportMe'),
    onSuccess: (data) => {
      saveJson(`hakit-export-${data.user.githubLogin}-${data.exportedAt.slice(0, 10)}.json`, data);
      setDone(true);
    },
  });
  return (
    <Panel title="Export my data">
      <div className="space-y-3 p-4">
        <p className="max-w-xl text-body text-muted">
          A JSON file with your profile, workspaces, skills and their evidence, assignments, task changes,
          activity, agent sessions and agent token names. Tokens and session ids are never included.
        </p>
        <Button
          loading={exp.isPending}
          onClick={() => {
            setDone(false);
            exp.mutate();
          }}
        >
          Export my data
        </Button>
        {done && (
          <p role="status" className="text-label text-muted">
            Export ready: check your downloads.
          </p>
        )}
        {exp.isError && (
          <p role="alert" className="text-label text-danger">
            Couldn't export your data ({exp.error.message}). Try again.
          </p>
        )}
      </div>
    </Panel>
  );
}

function DeleteAccount({ login }: { login: string }) {
  const id = useId();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const del = useMutation({
    mutationFn: () => api('deleteMe'),
    onSuccess: () => {
      qc.clear();
      nav('/login', { replace: true });
    },
  });
  const matches = typed.trim() === login;

  if (!open)
    return (
      <div className="space-y-3">
        <p className="max-w-xl text-body text-muted">
          Removes your account, sign-ins, GitHub connection, agent tokens and sessions, skills and profiles.
          Tasks and history you worked on stay with your team, without your name.
        </p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      </div>
    );

  return (
    <form
      className="animate-pop-in space-y-3 rounded-md border border-danger p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) del.mutate();
      }}
    >
      <p className="text-body text-default">
        <span className="font-medium text-danger">This can't be undone.</span> Workspaces where you are the
        only member are deleted too. If you're the only owner of a team, transfer ownership or delete that
        workspace first.
      </p>
      <div>
        <label htmlFor={`${id}-login`} className="text-label text-muted">
          Type your GitHub login <span className="font-mono text-default">{login}</span> to confirm
        </label>
        <input
          id={`${id}-login`}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          className={input}
          aria-invalid={typed.length > 0 && !matches}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={!matches} loading={del.isPending}>
          Delete my account
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped('');
            del.reset();
          }}
        >
          Cancel
        </Button>
      </div>
      {del.isError && (
        <p role="alert" className="text-label text-danger">
          Not deleted: {del.error.message}
        </p>
      )}
    </form>
  );
}

/* ------------------------------- Danger zone ------------------------------- */

export function DangerZonePanel({ wid }: { wid: string }) {
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });
  return (
    <Panel title="Delete workspace" className="border-danger">
      <div className="p-4">
        {workspace.isPending ? (
          <LoadingBlocks label="Loading workspace" rows={1} />
        ) : workspace.isError ? (
          <ErrorBox what="the workspace" error={workspace.error} onRetry={() => void workspace.refetch()} />
        ) : (
          <DeleteWorkspaceForm wid={wid} name={workspace.data.name} />
        )}
      </div>
    </Panel>
  );
}

function DeleteWorkspaceForm({ wid, name }: { wid: string; name: string }) {
  const id = useId();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const del = useMutation({
    mutationFn: () => api('deleteWorkspace', { params: { wid }, body: { confirmName: typed.trim() } }),
    onSuccess: () => {
      // Every cached query may belong to the deleted workspace; start clean and let Home route onwards.
      qc.clear();
      nav('/', { replace: true });
    },
  });
  const matches = typed.trim() === name.trim();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) del.mutate();
      }}
    >
      <p className="max-w-xl text-body text-default">
        <span className="font-medium text-danger">This can't be undone.</span> Deletes the workspace for
        everyone: projects, plans, tasks, assignments, activity, recommendations, repo connections, invites
        and agent sessions. Members keep their accounts.
      </p>
      <div>
        <label htmlFor={`${id}-name`} className="text-label text-muted">
          Type the workspace name <span className="font-mono text-default">{name}</span> to confirm
        </label>
        <input
          id={`${id}-name`}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          className={input}
          aria-invalid={typed.length > 0 && !matches}
        />
      </div>
      <Button type="submit" variant="danger" disabled={!matches} loading={del.isPending}>
        Delete this workspace
      </Button>
      {del.isError && (
        <p role="alert" className="text-label text-danger">
          Not deleted: {del.error.message}
        </p>
      )}
    </form>
  );
}
