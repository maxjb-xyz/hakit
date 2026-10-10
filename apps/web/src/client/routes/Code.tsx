/**
 * S12 Code (DESIGN §8). GitHub activity for the project: the connected repo, open PRs, branches and a feed.
 * Uses FAKE data from mocks/code.ts + mocks/plan.ts + mocks/team.ts until the backend is connected.
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ActivityEvent, ActivityKind, LinkKind, Member, Task } from '@hakit/contracts';
import { MOCK_NOW } from '../mocks/fake';
import {
  fetchActivity,
  fetchBranches,
  fetchPullRequests,
  fetchRepo,
  type BranchSummary,
  type PullRequestState,
  type PullRequestSummary,
} from '../mocks/code';
import { fetchBoard } from '../mocks/plan';
import { fetchMembers } from '../mocks/team';
import { Panel, ago, memberName } from './mission-control/shared';
import { MemberAvatar } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, MockChip, PageHeader, Pill } from './page-states';

export function Code() {
  // TODO: replace with api call. See the fetch functions in mocks/code.ts for the matching endpoint names.
  // Also swap MOCK_NOW for `useNow()` from mission-control/shared.
  const repo = useQuery({ queryKey: ['mock', 'repo'], queryFn: fetchRepo });
  const prs = useQuery({ queryKey: ['mock', 'prs'], queryFn: fetchPullRequests });
  const branches = useQuery({ queryKey: ['mock', 'branches'], queryFn: fetchBranches });
  const activity = useQuery({ queryKey: ['mock', 'activity'], queryFn: fetchActivity });
  const board = useQuery({ queryKey: ['mock', 'board'], queryFn: fetchBoard });
  const members = useQuery({ queryKey: ['mock', 'members'], queryFn: fetchMembers });

  // Small lookups so rows can show "Priya" and "HK-2" instead of raw ids.
  const lookup: CodeLookup = {
    wid: useParams().wid ?? '',
    now: MOCK_NOW,
    member: (id) => members.data?.find((m) => m.user.id === id),
    task: (id) => board.data?.tasks.find((t) => t.id === id),
  };

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Code"
        subtitle={
          repo.data ? (
            <a href={repo.data.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-strong">
              {repo.data.fullName}
            </a>
          ) : undefined
        }
      >
        {repo.data && (
          <>
            <Pill>
              <span className="font-mono">{repo.data.defaultBranch}</span>
              <span className="text-subtle">default</span>
            </Pill>
            <Pill tone="success">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              GitHub App installed
            </Pill>
          </>
        )}
        <MockChip />
      </PageHeader>

      {repo.isError && (
        <ErrorBox what="the repository" error={repo.error} onRetry={() => void repo.refetch()} />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          <Panel title="Pull requests" meta={prs.data ? `${openCount(prs.data)} open` : undefined}>
            <Section query={prs} what="pull requests" empty="No pull requests yet.">
              {(list) => (
                <ul className="divide-y divide-border">
                  {list.map((pr) => (
                    <PullRequestRow key={pr.number} pr={pr} lookup={lookup} />
                  ))}
                </ul>
              )}
            </Section>
          </Panel>

          <Panel title="Branches" meta={branches.data ? `${branches.data.length} active` : undefined}>
            <Section query={branches} what="branches" empty="No branches besides the default one.">
              {(list) => (
                <ul className="divide-y divide-border">
                  {list.map((b) => (
                    <BranchRow key={b.name} branch={b} lookup={lookup} />
                  ))}
                </ul>
              )}
            </Section>
          </Panel>
        </div>

        <div className="min-w-0 lg:col-span-2">
          <Panel title="Recent activity">
            <Section
              query={activity}
              what="activity"
              empty="No commits or PRs yet. Activity shows up here a few seconds after a push."
            >
              {(list) => (
                <ol className="divide-y divide-border">
                  {list.map((e) => (
                    <ActivityRow key={e.id} event={e} lookup={lookup} />
                  ))}
                </ol>
              )}
            </Section>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- shared bits ----------------------------- */

type CodeLookup = {
  wid: string;
  now: number;
  member: (id: string | null) => Member | undefined;
  task: (id: string | null) => Task | undefined;
};

const openCount = (prs: PullRequestSummary[]) =>
  prs.filter((p) => p.state === 'open' || p.state === 'draft').length;

/** Shows loading / error / empty for one panel, and calls `children` with the data once it's there. */
function Section<T>(props: {
  query: { data?: T[]; isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown };
  what: string;
  empty: string;
  children: (data: T[]) => ReactNode;
}) {
  const q = props.query;
  return (
    <div className="p-2">
      {q.isPending ? (
        <LoadingBlocks label={`Loading ${props.what}`} rows={3} />
      ) : q.isError ? (
        <ErrorBox
          what={props.what}
          error={q.error ?? new Error('Unknown error')}
          onRetry={() => q.refetch()}
        />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyBox message={props.empty} />
      ) : (
        props.children(q.data)
      )}
    </div>
  );
}

/** "HK-2 Database schema" link, plus "inferred 71%" when Hakit guessed the link (DESIGN §2.5). */
function LinkedTask(props: {
  taskId: string | null;
  linkKind: LinkKind;
  confidence?: number | null;
  lookup: CodeLookup;
}) {
  const task = props.lookup.task(props.taskId);
  if (!task || props.linkKind === 'none')
    return <span className="text-label text-subtle">No linked task</span>;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-label">
      <Link
        to={`/w/${props.lookup.wid}/tasks?task=${task.key}`}
        className="inline-flex min-w-0 items-baseline gap-1.5 hover:text-strong"
      >
        <span className="shrink-0 font-mono text-subtle">{task.key}</span>
        <span className="truncate text-muted">{task.title}</span>
      </Link>
      {props.linkKind === 'inferred' ? (
        <span className="shrink-0 text-warning" title="Hakit guessed this link. Confirm it on the task.">
          inferred{props.confidence != null && ` ${Math.round(props.confidence * 100)}%`}
        </span>
      ) : (
        <span className="shrink-0 text-subtle">confirmed</span>
      )}
    </span>
  );
}

/** Avatar + name, or the raw GitHub login/email when we couldn't match the author to a member. */
function Author(props: { userId: string | null; raw?: string | null; lookup: CodeLookup }) {
  const m = props.lookup.member(props.userId);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-label text-muted">
      <MemberAvatar member={m} className="size-5" />
      <span className="truncate">{m ? memberName(m) : (props.raw ?? 'Unknown')}</span>
      {!m && props.raw && <span className="shrink-0 text-warning">unmapped author</span>}
    </span>
  );
}

/* ----------------------------- pull requests ----------------------------- */

const PR_STATE: Record<PullRequestState, { label: string; tone: 'muted' | 'success' | 'accent' | 'danger' }> =
  {
    draft: { label: 'Draft', tone: 'muted' },
    open: { label: 'Open', tone: 'success' },
    merged: { label: 'Merged', tone: 'accent' },
    closed: { label: 'Closed', tone: 'danger' },
  };

function PullRequestRow({ pr, lookup }: { pr: PullRequestSummary; lookup: CodeLookup }) {
  const state = PR_STATE[pr.state];
  return (
    <li className="flex flex-col gap-1.5 px-2 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Pill tone={state.tone}>{state.label}</Pill>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-body text-default hover:text-strong"
        >
          <span className="text-subtle">#{pr.number}</span> {pr.title}
        </a>
        <span className="ml-auto shrink-0 text-label text-subtle">{ago(pr.updatedAt, lookup.now)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Author userId={pr.authorUserId} lookup={lookup} />
        <span className="font-mono text-label text-subtle">{pr.branch}</span>
        <span className="text-label text-muted">
          {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}
          {pr.changesRequested > 0 && (
            <span className="text-danger"> · {pr.changesRequested} change request</span>
          )}
        </span>
        <span className="font-mono text-label">
          <span className="text-success">+{pr.additions}</span>{' '}
          <span className="text-danger">−{pr.deletions}</span>
        </span>
      </div>
      <LinkedTask taskId={pr.taskId} linkKind={pr.linkKind} lookup={lookup} />
    </li>
  );
}

/* ----------------------------- branches ----------------------------- */

function BranchRow({ branch: b, lookup }: { branch: BranchSummary; lookup: CodeLookup }) {
  return (
    <li className="flex flex-col gap-1.5 px-2 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-mono text-body text-default">{b.name}</span>
        {b.prNumber !== null && <Pill tone="info">PR #{b.prNumber}</Pill>}
        <span className="ml-auto shrink-0 text-label text-subtle">{ago(b.lastCommitAt, lookup.now)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Author userId={b.authorUserId} lookup={lookup} />
        <span className="font-mono text-label text-subtle">{b.lastCommitSha}</span>
        {b.ahead !== null && b.behind !== null && (
          <span className="text-label text-muted" title="Commits ahead / behind the default branch">
            {b.ahead} ahead ·{' '}
            <span className={b.behind > 5 ? 'text-warning' : undefined}>{b.behind} behind</span>
          </span>
        )}
      </div>
      <LinkedTask taskId={b.taskId} linkKind={b.linkKind} lookup={lookup} />
    </li>
  );
}

/* ----------------------------- activity feed ----------------------------- */

/** Short verb for each kind of GitHub event. Agent / Hakit kinds fall back to "Activity". */
const KIND_LABEL: Partial<Record<ActivityKind, string>> = {
  commit: 'Commit',
  branch_created: 'Branch',
  branch_deleted: 'Branch deleted',
  pr_opened: 'PR opened',
  pr_updated: 'PR updated',
  pr_merged: 'PR merged',
  pr_closed: 'PR closed',
  pr_review: 'Review',
};

function ActivityRow({ event: e, lookup }: { event: ActivityEvent; lookup: CodeLookup }) {
  return (
    <li className="flex flex-col gap-1 px-2 py-3">
      <div className="flex items-center gap-2 text-label">
        <span className="text-caption uppercase tracking-wide text-subtle">
          {KIND_LABEL[e.kind] ?? 'Activity'}
        </span>
        {e.ref && <span className="truncate font-mono text-subtle">{e.ref}</span>}
        <span className="ml-auto shrink-0 text-subtle">{ago(e.ts, lookup.now)}</span>
      </div>
      {e.url ? (
        <a href={e.url} target="_blank" rel="noreferrer" className="text-body text-default hover:text-strong">
          {e.title}
        </a>
      ) : (
        <p className="text-body text-default">{e.title}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Author userId={e.actorUserId} raw={e.actorRaw} lookup={lookup} />
        {e.additions !== null && e.deletions !== null && (
          <span className="font-mono text-label">
            <span className="text-success">+{e.additions}</span>{' '}
            <span className="text-danger">−{e.deletions}</span>
          </span>
        )}
      </div>
      {e.linkKind !== 'none' && (
        <LinkedTask taskId={e.taskId} linkKind={e.linkKind} confidence={e.linkConfidence} lookup={lookup} />
      )}
    </li>
  );
}
