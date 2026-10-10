/**
 * Repo connection panel for S12 (T-407, INTEGRATIONS §1.4/§1.6): pick a repo the Hakit GitHub App can see,
 * add one on GitHub (App install URL), or create a new one through GitHub's prefilled "new repository" page.
 */
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RepoSummary } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { Panel } from '../mission-control/shared';
import { EmptyBox, ErrorBox, LoadingBlocks } from '../page-states';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
const VALID_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function RepoConnection(props: {
  wid: string;
  pid: string;
  projectName: string;
  pitch: string | null;
  currentRepoId: number | null;
  repos: {
    data?: RepoSummary[];
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => unknown;
    isFetching: boolean;
  };
  onDone: () => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const groupId = useId();
  const [picked, setPicked] = useState<number | null>(props.currentRepoId);

  const install = useMutation({
    mutationFn: () => api('installUrl', { query: { workspaceId: props.wid } }),
    // GitHub sends people back through the Setup URL, which returns them to Hakit.
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const connect = useMutation({
    mutationFn: (repoId: number) => api('connectRepo', { params: { pid: props.pid }, body: { repoId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk('getProject', { pid: props.pid }) });
      void qc.invalidateQueries({ queryKey: ['listActivity'] });
      props.onDone();
    },
  });

  const repos = props.repos.data ?? [];
  return (
    <Panel
      title={props.currentRepoId === null ? 'Connect a repository' : 'Change repository'}
      meta="Hakit reads commits, branches and PRs. It never reads code."
    >
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <section aria-labelledby={`${groupId}-pick`} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 id={`${groupId}-pick`} className="text-body font-medium text-strong">
              Pick a repository
            </h3>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              loading={props.repos.isFetching && !props.repos.isPending}
              onClick={() => void props.repos.refetch()}
            >
              Refresh list
            </Button>
          </div>
          {props.repos.isPending ? (
            <LoadingBlocks label="Loading repositories" rows={2} />
          ) : props.repos.isError ? (
            <ErrorBox
              what="your repositories"
              error={props.repos.error ?? new Error('Unknown error')}
              onRetry={() => void props.repos.refetch()}
            />
          ) : repos.length === 0 ? (
            <EmptyBox message="The Hakit GitHub App can't see any repositories yet. Add one on GitHub, then refresh." />
          ) : (
            <fieldset className="space-y-1">
              <legend className="sr-only">Repositories the Hakit GitHub App can see</legend>
              {repos.map((r) => (
                <label
                  key={r.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 hover:bg-hover',
                    picked === r.id ? 'border-border-strong bg-raised' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name={`${groupId}-repo`}
                    value={r.id}
                    checked={picked === r.id}
                    onChange={() => setPicked(r.id)}
                    className="accent-accent-500"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-body text-default">
                    {r.fullName}
                  </span>
                  <span className="shrink-0 text-label text-subtle">
                    {r.private ? 'Private' : 'Public'}
                    {r.id === props.currentRepoId && ' · connected'}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={picked === null || picked === props.currentRepoId}
              loading={connect.isPending}
              onClick={() => picked !== null && connect.mutate(picked)}
            >
              Connect repository
            </Button>
            <Button variant="secondary" loading={install.isPending} onClick={() => install.mutate()}>
              Add repository on GitHub
            </Button>
            {props.onCancel && (
              <Button variant="ghost" onClick={props.onCancel}>
                Cancel
              </Button>
            )}
          </div>
          <p className="text-label text-subtle">
            Connecting imports the last 48 hours of commits, branches and PRs, then updates live.
          </p>
          {connect.isError && (
            <p role="alert" className="text-label text-danger">
              Couldn't connect ({connect.error.message}). Nothing changed; try again.
            </p>
          )}
          {install.isError && (
            <p role="alert" className="text-label text-danger">
              Couldn't start the GitHub install ({install.error.message}).
            </p>
          )}
        </section>

        <CreateRepo projectName={props.projectName} pitch={props.pitch} />
      </div>
    </Panel>
  );
}

function CreateRepo(props: { projectName: string; pitch: string | null }) {
  const id = useId();
  const [name, setName] = useState(() => slug(props.projectName) || 'hackathon-project');
  const [isPrivate, setPrivate] = useState(false);
  const valid = VALID_NAME.test(name);
  const create = useMutation({
    mutationFn: () =>
      api('createRepo', {
        body: {
          name,
          private: isPrivate,
          ...(props.pitch ? { description: props.pitch.slice(0, 350) } : {}),
        },
      }),
  });
  const result = create.data;
  return (
    <section aria-labelledby={`${id}-h`} className="min-w-0 space-y-3 lg:border-l lg:border-border lg:pl-6">
      <h3 id={`${id}-h`} className="text-body font-medium text-strong">
        Or start a new repository
      </h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className="text-label text-muted">
            Repository name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              create.reset();
            }}
            aria-invalid={!valid}
            aria-describedby={`${id}-hint`}
            className="h-control-md w-full rounded-sm border border-border bg-raised px-3 font-mono text-body text-default placeholder:text-disabled"
          />
          <p id={`${id}-hint`} className={cn('text-label', valid ? 'text-subtle' : 'text-danger')}>
            {valid
              ? 'Letters, numbers, dots, dashes and underscores.'
              : 'Use only letters, numbers, . - and _ (max 100).'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-body text-default">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setPrivate(e.target.checked)}
            className="accent-accent-500"
          />
          Private repository
        </label>
        <Button type="submit" variant="secondary" disabled={!valid} loading={create.isPending}>
          Create on GitHub
        </Button>
      </form>
      {create.isError && (
        <p role="alert" className="text-label text-danger">
          Couldn't prepare the repository ({create.error.message}).
        </p>
      )}
      {result?.mode === 'guided' && (
        <div className="space-y-2 rounded-sm border border-border bg-raised p-3">
          <ol className="list-decimal space-y-1 pl-5 text-body text-default">
            <li>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="text-strong underline decoration-border-strong underline-offset-2"
              >
                Open GitHub's prefilled new-repository page
              </a>{' '}
              and click Create.
            </li>
            <li>
              Use “Add repository on GitHub” to give the Hakit App access, if it isn't on all repositories.
            </li>
            <li>Refresh the list and connect it.</li>
          </ol>
        </div>
      )}
      {result?.mode === 'created' && (
        <p role="status" className="text-label text-success">
          Created {result.repo.fullName}. Refresh the list and connect it.
        </p>
      )}
    </section>
  );
}
