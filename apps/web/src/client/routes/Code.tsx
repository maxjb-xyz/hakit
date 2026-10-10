/**
 * S12 Code (DESIGN §8). GitHub activity for the project repo: pull requests, branches and a recent feed.
 * Uses FAKE data from mocks/code.ts (+ team/plan mocks for names and task keys) until the backend is connected.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ActivityEvent, ActivityKind, Member, Task } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import {
  fetchActivity,
  fetchBranches,
  fetchPullRequests,
  fetchRepo,
  type BranchSummary,
  type PullRequestState,
  type PullRequestSummary,
} from '../mocks/code';
import { MOCK_NOW } from '../mocks/fake';
import { fetchBoard } from '../mocks/plan';
import { fetchMembers } from '../mocks/team';
import { Panel, ago, memberName } from './mission-control/shared';
import { MemberAvatar } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, MockChip, PageHeader, Pill, TaskLinkChip } from './page-states';

/** Helpers every section needs: look up a member or task by id, and "now" for relative times. */
type Lookup = {
  member: (id: string | null) => Member | undefined;
  task: (id: string | null) => Task | undefined;
  now: number;
};

export function Code() {
  // TODO: replace with api call. Each queryFn becomes the `api(...)` call written next to it in mocks/code.ts.
  // Also swap MOCK_NOW for `useNow()` from mission-control/shared.
  const repo = useQuery({ queryKey: ['mock', 'repo'], queryFn: fetchRepo });
  const activity = useQuery({ queryKey: ['mock', 'activity'], queryFn: fetchActivity });
  const branches = useQuery({ queryKey: ['mock', 'branches'], queryFn: fetchBranches });
  const pulls = useQuery({ queryKey: ['mock', 'pulls'], queryFn: fetchPullRequests });
  const members = useQuery({ queryKey: ['mock', 'members'], queryFn: fetchMembers });
  const board = useQuery({ queryKey: ['mock', 'board'], queryFn: fetchBoard });

  // '' means "everyone"; otherwise a user id.
  const [memberFilter, setMemberFilter] = useState('');
  const byMember = (userId: string | null) => memberFilter === '' || userId === memberFilter;

  const lookup: Lookup = {
    member: (id) => members.data?.find((m) => m.user.id === id),
    task: (id) => board.data?.tasks.find((t) => t.id === id),
    now: MOCK_NOW,
  };

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Code"
        subtitle={
          repo.data ? (
            <>
              <a
                href={repo.data.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-default hover:underline"
              >
                {repo.data.fullName}
              </a>{' '}
              · default branch <span className="font-mono">{repo.data.defaultBranch}</span> · last push{' '}
              {ago(repo.data.pushedAt, MOCK_NOW)}
            </>
          ) : undefined
        }
      >
        {repo.data && (
          <Pill tone="success">
            <span aria-hidden>✓</span> GitHub App installed
          </Pill>
        )}
        <MockChip />
      </PageHeader>

      {repo.isError && (
        <ErrorBox what="the repository" error={repo.error} onRetry={() => void repo.refetch()} />
      )}

      <label className="flex w-fit items-center gap-2 text-label text-muted">
        Member
        <select
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          className="h-control-md rounded-sm border border-border bg-surface px-2 text-body text-default"
        >
          <option value="">Everyone</option>
          {members.data?.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {memberName(m)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Panel title="Pull requests" meta={pulls.data?.filter((p) => byMember(p.authorUserId)).length}>
            {pulls.isPending ? (
              <div className="p-4">
                <LoadingBlocks label="Loading pull requests" rows={2} />
              </div>
            ) : pulls.isError ? (
              <div className="p-4">
                <ErrorBox what="pull requests" error={pulls.error} onRetry={() => void pulls.refetch()} />
              </div>
            ) : (
              <PullList pulls={pulls.data.filter((p) => byMember(p.authorUserId))} lookup={lookup} />
            )}
          </Panel>

          <Panel title="Branches" meta={branches.data?.filter((b) => byMember(b.authorUserId)).length}>
            {branches.isPending ? (
              <div className="p-4">
                <LoadingBlocks label="Loading branches" rows={2} />
              </div>
            ) : branches.isError ? (
              <div className="p-4">
                <ErrorBox what="branches" error={branches.error} onRetry={() => void branches.refetch()} />
              </div>
            ) : (
              <BranchTable branches={branches.data.filter((b) => byMember(b.authorUserId))} lookup={lookup} />
            )}
          </Panel>
        </div>

        <div className="min-w-0">
          <Panel title="Recent activity">
            {activity.isPending ? (
              <div className="p-4">
                <LoadingBlocks label="Loading activity" rows={3} />
              </div>
            ) : activity.isError ? (
              <div className="p-4">
                <ErrorBox what="activity" error={activity.error} onRetry={() => void activity.refetch()} />
              </div>
            ) : (
              <ActivityList
                // Unmapped authors (no user id) only show under "Everyone".
                events={activity.data.filter((e) => e.source === 'github' && byMember(e.actorUserId))}
                lookup={lookup}
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- pull requests ----------------------------- */

/** Each state has its own symbol *and* word, so it doesn't rely on colour alone. */
const PR_STATE: Record<
  PullRequestState,
  { label: string; icon: string; tone: 'muted' | 'success' | 'accent' | 'danger' }
> = {
  draft: { label: 'Draft', icon: '◌', tone: 'muted' },
  open: { label: 'Open', icon: '●', tone: 'success' },
  merged: { label: 'Merged', icon: '✓', tone: 'accent' },
  closed: { label: 'Closed', icon: '✕', tone: 'danger' },
};

function reviewText(p: PullRequestSummary) {
  if (p.changesRequested > 0) return 'Changes requested';
  if (p.approvals > 0) return `${p.approvals} approval${p.approvals === 1 ? '' : 's'}`;
  return 'No reviews yet';
}

function PullList({ pulls, lookup }: { pulls: PullRequestSummary[]; lookup: Lookup }) {
  if (pulls.length === 0) {
    return (
      <div className="p-4">
        <EmptyBox message="No pull requests yet. Open one from a branch named like hk-12-short-title to link it." />
      </div>
    );
  }
  return (
    <ul>
      {pulls.map((p) => {
        const state = PR_STATE[p.state];
        const author = lookup.member(p.authorUserId);
        return (
          <li
            key={p.number}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0"
          >
            <Pill tone={state.tone} className="w-20 justify-center">
              <span aria-hidden>{state.icon}</span>
              {state.label}
            </Pill>
            <div className="min-w-0 flex-1 basis-56">
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-body text-strong hover:underline"
              >
                {p.title} <span className="text-subtle">#{p.number}</span>
              </a>
              <p className="truncate text-label text-subtle">
                <span className="font-mono">{p.branch}</span> · {memberName(author)} · updated{' '}
                {ago(p.updatedAt, lookup.now)}
              </p>
            </div>
            <span
              className={cn('text-label', p.changesRequested > 0 ? 'text-warning' : 'text-muted')}
              title="Reviews"
            >
              {reviewText(p)}
            </span>
            <span
              className="font-mono text-label"
              aria-label={`${p.additions} added, ${p.deletions} removed`}
            >
              <span className="text-success">+{p.additions}</span>{' '}
              <span className="text-danger">−{p.deletions}</span>
            </span>
            <TaskLinkChip task={lookup.task(p.taskId)} linkKind={p.linkKind} />
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------- branches ----------------------------- */

function BranchTable({ branches, lookup }: { branches: BranchSummary[]; lookup: Lookup }) {
  if (branches.length === 0) {
    return (
      <div className="p-4">
        <EmptyBox message="No branches besides the default one yet." />
      </div>
    );
  }
  const th = 'px-4 py-2 text-left text-caption font-medium uppercase tracking-wide text-subtle';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl text-body">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>Branch</th>
            <th className={th}>Author</th>
            <th className={th}>Task</th>
            <th className={th} title="Commits ahead / behind the default branch">
              Ahead / behind
            </th>
            <th className={th}>Last commit</th>
            <th className={th}>PR</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => {
            const author = lookup.member(b.authorUserId);
            return (
              <tr key={b.name} className="border-b border-border last:border-b-0 hover:bg-hover">
                <td className="px-4 py-2 font-mono text-label text-default">{b.name}</td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2 text-muted">
                    <MemberAvatar member={author} />
                    {memberName(author)}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <TaskLinkChip task={lookup.task(b.taskId)} linkKind={b.linkKind} />
                </td>
                <td className="px-4 py-2 font-mono text-label text-muted">
                  {b.ahead === null ? '—' : `↑${b.ahead} ↓${b.behind ?? 0}`}
                </td>
                <td className="px-4 py-2 text-label text-muted">
                  <span className="font-mono">{b.lastCommitSha}</span> · {ago(b.lastCommitAt, lookup.now)}
                </td>
                <td className="px-4 py-2 text-label text-muted">{b.prNumber ? `#${b.prNumber}` : 'None'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- activity feed ----------------------------- */

const KIND: Partial<Record<ActivityKind, { icon: string; label: string }>> = {
  commit: { icon: '●', label: 'Commit' },
  branch_created: { icon: '⑂', label: 'New branch' },
  branch_deleted: { icon: '⑂', label: 'Deleted branch' },
  pr_opened: { icon: '↗', label: 'PR opened' },
  pr_updated: { icon: '↻', label: 'PR updated' },
  pr_merged: { icon: '✓', label: 'PR merged' },
  pr_closed: { icon: '✕', label: 'PR closed' },
  pr_review: { icon: '◎', label: 'Review' },
};

function ActivityList({ events, lookup }: { events: ActivityEvent[]; lookup: Lookup }) {
  if (events.length === 0) {
    return (
      <div className="p-4">
        <EmptyBox message="No GitHub activity yet. Push a commit to see it here." />
      </div>
    );
  }
  return (
    <ol>
      {events.map((e) => {
        const kind = KIND[e.kind] ?? { icon: '•', label: e.kind };
        const actor = lookup.member(e.actorUserId);
        return (
          <li key={e.id} className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <MemberAvatar member={actor} className="mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-body text-default">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-label text-subtle">
                <span>
                  <span aria-hidden>{kind.icon} </span>
                  {kind.label}
                </span>
                <span>
                  {actor ? (
                    memberName(actor)
                  ) : (
                    <span
                      className="text-warning"
                      title="This commit email isn't mapped to a team member yet"
                    >
                      {e.actorRaw ?? 'Unknown'} (not mapped)
                    </span>
                  )}
                </span>
                {e.sha && <span className="font-mono">{e.sha.slice(0, 7)}</span>}
                {e.additions !== null && (
                  <span className="font-mono">
                    <span className="text-success">+{e.additions}</span>{' '}
                    <span className="text-danger">−{e.deletions ?? 0}</span>
                  </span>
                )}
                <span>{ago(e.ts, lookup.now)}</span>
              </p>
              <TaskLinkChip
                task={lookup.task(e.taskId)}
                linkKind={e.linkKind}
                confidence={e.linkConfidence}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
