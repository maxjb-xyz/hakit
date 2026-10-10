/**
 * S12 Code (DESIGN §8, T-407). The project's GitHub activity: repo connection, filtered feed, PR and branch
 * tables derived from that feed, the unlinked-activity queue and unknown-author mapping.
 * Live: the project socket invalidates `listActivity` on `activity.created`.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEvent, ActivityKind, Member, Page, Task } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProject } from '../lib/project';
import { useProjectSocket } from '../lib/ws';
import { Panel, ago, memberName, useNow } from './mission-control/shared';
import { MemberAvatar, Picker } from './tasks/meta';
import {
  EmptyBox,
  ErrorBox,
  LoadingBlocks,
  PageHeader,
  Pill,
  ProjectGate,
  TaskLinkChip,
} from './page-states';
import { RepoConnection } from './code/RepoConnection';
import {
  NO_FILTERS,
  TYPE_FILTERS,
  branches as deriveBranches,
  filterFeed,
  pullRequests as derivePullRequests,
  unknownAuthors,
  unlinkedQueue,
  type BranchRow,
  type FeedFilters,
  type LinkFilter,
  type PrState,
  type PullRequestRow,
  type TypeFilter,
  type UnknownAuthor,
} from './code/derive';

export function Code() {
  const { wid = '' } = useParams();
  const { pid, query } = useProject(wid);
  if (!pid) return <ProjectGate query={query} title="Code" />;
  return <CodeScreen key={pid} wid={wid} pid={pid} />;
}

function CodeScreen({ wid, pid }: { wid: string; pid: string }) {
  const now = useNow();
  const socket = useProjectSocket(pid);
  const [connecting, setConnecting] = useState(false);
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);

  const project = useQuery({
    queryKey: qk('getProject', { pid }),
    queryFn: () => api('getProject', { params: { pid } }),
  });
  const repos = useQuery({ queryKey: qk('listRepos'), queryFn: () => api('listRepos') });
  const activity = useQuery({
    queryKey: qk('listActivity', { pid }),
    queryFn: () => api('listActivity', { params: { pid } }),
  });
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });

  const repoId = project.data?.repoId ?? null;
  const repo = repoId === null ? undefined : repos.data?.find((r) => r.id === repoId);
  const events = useMemo(() => activity.data?.items ?? [], [activity.data]);
  const prs = useMemo(() => derivePullRequests(events), [events]);
  const branchRows = useMemo(() => deriveBranches(events, repo?.defaultBranch ?? null), [events, repo]);

  const lookup: CodeLookup = {
    now,
    tasks: board.data?.tasks ?? [],
    members: members.data ?? [],
    member: (id) => members.data?.find((m) => m.user.id === id),
    task: (id) => board.data?.tasks.find((t) => t.id === id),
  };

  const showConnection = connecting || (project.isSuccess && repoId === null);

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Code"
        subtitle={
          repo ? (
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-strong">
              {repo.fullName}
            </a>
          ) : repoId !== null && repos.isSuccess ? (
            'Connected repository is no longer visible to your GitHub installations.'
          ) : undefined
        }
      >
        {repo && (
          <>
            <Pill>
              <span className="font-mono">{repo.defaultBranch}</span>
              <span className="text-subtle">default</span>
            </Pill>
            <Pill tone="success" title="The Hakit GitHub App can see this repository">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              GitHub App installed
            </Pill>
            {repo.private && <Pill>Private</Pill>}
          </>
        )}
        {repoId !== null && !connecting && (
          <Button size="sm" variant="ghost" onClick={() => setConnecting(true)}>
            Change repository
          </Button>
        )}
        <LiveChip state={socket.state} polling={socket.polling} />
      </PageHeader>

      {project.isError && (
        <ErrorBox what="the project" error={project.error} onRetry={() => void project.refetch()} />
      )}
      {project.isPending && <LoadingBlocks label="Loading repository" rows={1} />}

      {showConnection && (
        <RepoConnection
          wid={wid}
          pid={pid}
          projectName={project.data?.name ?? ''}
          pitch={project.data?.pitch ?? null}
          currentRepoId={repoId}
          repos={repos}
          onDone={() => setConnecting(false)}
          onCancel={repoId !== null ? () => setConnecting(false) : undefined}
        />
      )}

      <AttentionRow events={events} activity={activity} lookup={lookup} wid={wid} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          <Panel
            title="Pull requests"
            meta={activity.isSuccess ? `${prs.filter((p) => p.state === 'open').length} open` : undefined}
          >
            <Section
              query={activity}
              rows={prs}
              what="pull requests"
              empty="No pull requests in the activity window. Open one on a branch named hk-<number>-… to link it to a task."
            >
              {(list) => <PullRequestTable rows={list} lookup={lookup} />}
            </Section>
          </Panel>

          <Panel
            title="Branches"
            meta={activity.isSuccess ? `${branchRows.filter((b) => !b.deleted).length} active` : undefined}
          >
            <Section
              query={activity}
              rows={branchRows}
              what="branches"
              empty="No branches besides the default one have activity yet."
            >
              {(list) => <BranchTable rows={list} lookup={lookup} />}
            </Section>
          </Panel>
        </div>

        <div className="min-w-0 lg:col-span-2">
          <Panel title="Activity" meta={activity.isSuccess ? `${events.length} events` : undefined}>
            <FeedFilterBar filters={filters} onChange={setFilters} lookup={lookup} />
            <Feed
              activity={activity}
              filters={filters}
              lookup={lookup}
              onClear={() => setFilters(NO_FILTERS)}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- shared bits ----------------------------- */

export type CodeLookup = {
  now: number;
  tasks: Task[];
  members: Member[];
  member: (id: string | null) => Member | undefined;
  task: (id: string | null) => Task | undefined;
};

type ActivityQuery = {
  data?: Page<ActivityEvent>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  refetch: () => unknown;
};

function LiveChip({ state, polling }: { state: 'connecting' | 'open' | 'closed'; polling: boolean }) {
  return state === 'open' ? (
    <span role="status" className="text-label text-subtle">
      Live
    </span>
  ) : (
    <span role="status" className="text-label text-warning">
      {polling ? 'Reconnecting · updating every 10s' : 'Reconnecting…'}
    </span>
  );
}

/** Loading / error / empty for a panel whose rows are derived from the activity query. */
function Section<T>(props: {
  query: ActivityQuery;
  rows: T[];
  what: string;
  empty: string;
  emptyAction?: ReactNode;
  children: (rows: T[]) => ReactNode;
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
          onRetry={() => void q.refetch()}
        />
      ) : props.rows.length === 0 ? (
        <EmptyBox message={props.empty} action={props.emptyAction} />
      ) : (
        props.children(props.rows)
      )}
    </div>
  );
}

/** Avatar + name, or the raw GitHub login/email (labelled) when the author isn't mapped to a member. */
function Author(props: { userId: string | null; raw?: string | null; lookup: CodeLookup }) {
  const m = props.lookup.member(props.userId);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-label text-muted">
      <MemberAvatar member={m} className="size-5" />
      <span className="truncate">{m ? memberName(m) : (props.raw ?? 'Unknown')}</span>
      {!m && props.raw && <span className="shrink-0 text-warning">unmapped</span>}
    </span>
  );
}

function TaskLink(props: {
  taskId: string | null;
  linkKind: ActivityEvent['linkKind'];
  confidence?: number | null;
  lookup: CodeLookup;
}) {
  return (
    <TaskLinkChip
      task={props.lookup.task(props.taskId)}
      linkKind={props.linkKind}
      confidence={props.confidence}
    />
  );
}

/** +/− are measured by GitHub; the words keep them readable without colour. */
function Diff({ additions, deletions }: { additions: number | null; deletions: number | null }) {
  if (additions === null || deletions === null) return null;
  return (
    <span className="font-mono text-label" aria-label={`${additions} lines added, ${deletions} removed`}>
      <span className="text-success">+{additions}</span> <span className="text-danger">−{deletions}</span>
    </span>
  );
}

const PR_STATE: Record<PrState, { label: string; tone: 'success' | 'accent' | 'danger' }> = {
  open: { label: 'Open', tone: 'success' },
  merged: { label: 'Merged', tone: 'accent' },
  closed: { label: 'Closed', tone: 'danger' },
};

const th = 'px-2 py-2 text-left text-caption font-medium uppercase tracking-wide text-subtle';
const td = 'px-2 py-2.5 align-top';

/* ----------------------------- pull requests ----------------------------- */

function PullRequestTable({ rows, lookup }: { rows: PullRequestRow[]; lookup: CodeLookup }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl text-body">
        <caption className="sr-only">Pull requests</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>
              State
            </th>
            <th scope="col" className={th}>
              Pull request
            </th>
            <th scope="col" className={th}>
              Reviews
            </th>
            <th scope="col" className={th}>
              Task
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Updated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((pr) => (
            <tr key={pr.number}>
              <td className={td}>
                <Pill tone={PR_STATE[pr.state].tone}>{PR_STATE[pr.state].label}</Pill>
              </td>
              <td className={cn(td, 'min-w-0')}>
                {pr.url ? (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-default hover:text-strong"
                  >
                    <span className="text-subtle">#{pr.number}</span> {pr.title}
                  </a>
                ) : (
                  <span className="text-default">
                    <span className="text-subtle">#{pr.number}</span> {pr.title}
                  </span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Author userId={pr.authorUserId} raw={pr.authorRaw} lookup={lookup} />
                  {pr.branch && <span className="font-mono text-label text-subtle">{pr.branch}</span>}
                  <Diff additions={pr.additions} deletions={pr.deletions} />
                </div>
              </td>
              <td className={cn(td, 'text-label text-muted')}>
                {pr.reviews === 0 ? (
                  <span className="text-subtle">None yet</span>
                ) : (
                  <>
                    {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}
                    {pr.changesRequested > 0 && (
                      <span className="block text-danger">
                        {pr.changesRequested} change request{pr.changesRequested === 1 ? '' : 's'}
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className={td}>
                <TaskLink
                  taskId={pr.taskId}
                  linkKind={pr.linkKind}
                  confidence={pr.linkConfidence}
                  lookup={lookup}
                />
              </td>
              <td className={cn(td, 'text-right text-label whitespace-nowrap text-subtle')}>
                {ago(pr.updatedAt, lookup.now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- branches ----------------------------- */

function BranchTable({ rows, lookup }: { rows: BranchRow[]; lookup: CodeLookup }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl text-body">
        <caption className="sr-only">
          Branches with activity. Ahead/behind counts aren't available from activity data.
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>
              Branch
            </th>
            <th scope="col" className={th}>
              Author
            </th>
            <th scope="col" className={th}>
              Task
            </th>
            <th scope="col" className={th}>
              PR
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Last commit
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((b) => (
            <tr key={b.name}>
              <td className={cn(td, 'max-w-48')}>
                <span className={cn('block truncate font-mono text-default', b.deleted && 'line-through')}>
                  {b.name}
                </span>
                <span className="text-label text-subtle">
                  {b.deleted ? 'Deleted · ' : ''}
                  {b.commits} commit{b.commits === 1 ? '' : 's'}
                </span>
              </td>
              <td className={td}>
                <Author userId={b.authorUserId} raw={b.authorRaw} lookup={lookup} />
              </td>
              <td className={td}>
                <TaskLink
                  taskId={b.taskId}
                  linkKind={b.linkKind}
                  confidence={b.linkConfidence}
                  lookup={lookup}
                />
              </td>
              <td className={td}>
                {b.pr ? (
                  <Pill tone={PR_STATE[b.pr.state].tone}>
                    #{b.pr.number} {PR_STATE[b.pr.state].label}
                  </Pill>
                ) : (
                  <span className="text-label text-subtle">No PR</span>
                )}
              </td>
              <td className={cn(td, 'text-right text-label whitespace-nowrap')}>
                {b.lastCommitAt ? (
                  <>
                    <span className="text-subtle">{ago(b.lastCommitAt, lookup.now)}</span>
                    {b.lastCommitSha && (
                      <span className="block font-mono text-subtle">{b.lastCommitSha.slice(0, 7)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-subtle">No commits</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- activity feed ----------------------------- */

const KIND_LABEL: Partial<Record<ActivityKind, string>> = {
  commit: 'Commit',
  branch_created: 'Branch created',
  branch_deleted: 'Branch deleted',
  pr_opened: 'PR opened',
  pr_updated: 'PR updated',
  pr_merged: 'PR merged',
  pr_closed: 'PR closed',
  pr_review: 'Review',
};

const LINK_FILTERS: Record<LinkFilter, string> = {
  all: 'Any link',
  confirmed: 'Confirmed',
  inferred: 'Inferred',
  none: 'Unlinked',
};

function FeedFilterBar(props: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  lookup: CodeLookup;
}) {
  const set = <K extends keyof FeedFilters>(k: K, v: FeedFilters[K]) =>
    props.onChange({ ...props.filters, [k]: v });
  return (
    <div
      className="flex flex-wrap gap-2 border-b border-border px-4 py-2"
      role="group"
      aria-label="Filter activity"
    >
      <Picker label="Member" value={props.filters.member} onChange={(v) => set('member', v)}>
        <option value="">Everyone</option>
        {props.lookup.members.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            {memberName(m)}
          </option>
        ))}
        <option value="unmapped">Unmapped authors</option>
      </Picker>
      <Picker label="Type" value={props.filters.type} onChange={(v) => set('type', v as TypeFilter)}>
        {(Object.keys(TYPE_FILTERS) as TypeFilter[]).map((k) => (
          <option key={k} value={k}>
            {TYPE_FILTERS[k].label}
          </option>
        ))}
      </Picker>
      <Picker label="Task" value={props.filters.task} onChange={(v) => set('task', v)}>
        <option value="">Any task</option>
        {props.lookup.tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.key} {t.title}
          </option>
        ))}
      </Picker>
      <Picker label="Link" value={props.filters.link} onChange={(v) => set('link', v as LinkFilter)}>
        {(Object.keys(LINK_FILTERS) as LinkFilter[]).map((k) => (
          <option key={k} value={k}>
            {LINK_FILTERS[k]}
          </option>
        ))}
      </Picker>
    </div>
  );
}

function Feed(props: {
  activity: ActivityQuery;
  filters: FeedFilters;
  lookup: CodeLookup;
  onClear: () => void;
}) {
  const all = props.activity.data?.items ?? [];
  const rows = filterFeed(all, props.filters);
  const filtered = JSON.stringify(props.filters) !== JSON.stringify(NO_FILTERS);
  return (
    <Section
      query={props.activity}
      rows={rows}
      what="activity"
      empty={
        filtered
          ? 'No activity matches these filters.'
          : 'No commits or PRs yet. Activity shows up here a few seconds after a push.'
      }
      emptyAction={
        filtered ? (
          <Button size="sm" onClick={props.onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    >
      {(list) => (
        <ol className="divide-y divide-border" aria-live="polite">
          {list.map((e) => (
            <ActivityRow key={e.id} event={e} lookup={props.lookup} />
          ))}
        </ol>
      )}
    </Section>
  );
}

function ActivityRow({ event: e, lookup }: { event: ActivityEvent; lookup: CodeLookup }) {
  return (
    <li className="flex flex-col gap-1 px-2 py-3">
      <div className="flex items-center gap-2 text-label">
        <span className="text-caption uppercase tracking-wide text-subtle">
          {KIND_LABEL[e.kind] ?? 'Activity'}
        </span>
        {e.ref && <span className="truncate font-mono text-subtle">{e.ref}</span>}
        <time dateTime={e.ts} className="ml-auto shrink-0 text-subtle">
          {ago(e.ts, lookup.now)}
        </time>
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
        <Diff additions={e.additions} deletions={e.deletions} />
        <TaskLink taskId={e.taskId} linkKind={e.linkKind} confidence={e.linkConfidence} lookup={lookup} />
      </div>
    </li>
  );
}

/* ----------------------------- unlinked queue + author mapping ----------------------------- */

function AttentionRow(props: {
  events: ActivityEvent[];
  activity: ActivityQuery;
  lookup: CodeLookup;
  wid: string;
}) {
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const queue = unlinkedQueue(props.events, ignored);
  const authors = unknownAuthors(props.events);
  if (!props.activity.isSuccess || (queue.length === 0 && authors.length === 0)) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {queue.length > 0 && (
        <Panel
          title="Needs a task"
          meta={`${queue.length} unconfirmed`}
          className={cn(authors.length === 0 && 'lg:col-span-2')}
        >
          <ul className="divide-y divide-border">
            {queue.slice(0, 8).map((e) => (
              <UnlinkedRow
                key={e.id}
                event={e}
                lookup={props.lookup}
                onIgnore={() => setIgnored((s) => new Set(s).add(e.id))}
              />
            ))}
          </ul>
          {queue.length > 8 && (
            <p className="px-4 py-2 text-label text-subtle">
              {queue.length - 8} more. Filter the feed by “Unlinked” or “Inferred” to see them all.
            </p>
          )}
        </Panel>
      )}
      {authors.length > 0 && (
        <Panel
          title="Unknown authors"
          meta={`${authors.length} to map`}
          className={cn(queue.length === 0 && 'lg:col-span-2')}
        >
          <ul className="divide-y divide-border">
            {authors.map((a) => (
              <AuthorRow key={a.raw} author={a} lookup={props.lookup} wid={props.wid} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** Replace one event in the cached feed with the server's copy, so the change shows without a refetch. */
function useLinkActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { eid: string; taskId: string | null }) =>
      api('linkActivity', { params: { eid: v.eid }, body: { taskId: v.taskId } }),
    onSuccess: (event) =>
      qc.setQueryData<Page<ActivityEvent>>(qk('listActivity', { pid: event.projectId }), (page) =>
        page ? { ...page, items: page.items.map((e) => (e.id === event.id ? event : e)) } : page,
      ),
  });
}

function UnlinkedRow(props: { event: ActivityEvent; lookup: CodeLookup; onIgnore: () => void }) {
  const e = props.event;
  const link = useLinkActivity();
  const [choice, setChoice] = useState('');
  const suggested = e.linkKind === 'inferred' ? props.lookup.task(e.taskId) : undefined;
  const busy = link.isPending;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-caption uppercase tracking-wide text-subtle">
          {KIND_LABEL[e.kind] ?? 'Activity'}
        </span>
        <span className="min-w-0 truncate text-body text-default">{e.title}</span>
        <time dateTime={e.ts} className="ml-auto shrink-0 text-label text-subtle">
          {ago(e.ts, props.lookup.now)}
        </time>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {suggested ? (
          <>
            <span className="text-label text-muted">Suggested</span>
            <TaskLinkChip task={suggested} linkKind="inferred" confidence={e.linkConfidence} />
            <Button
              size="sm"
              variant="primary"
              loading={busy && link.variables?.taskId === suggested.id}
              disabled={busy}
              onClick={() => link.mutate({ eid: e.id, taskId: suggested.id })}
            >
              Confirm
            </Button>
          </>
        ) : (
          <span className="text-label text-subtle">No suggestion</span>
        )}
        <Picker label={`Choose a task for “${e.title}”`} value={choice} onChange={setChoice}>
          <option value="">Choose task…</option>
          {props.lookup.tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.key} {t.title}
            </option>
          ))}
        </Picker>
        <Button
          size="sm"
          disabled={!choice || busy}
          loading={busy && link.variables?.taskId === choice}
          onClick={() => link.mutate({ eid: e.id, taskId: choice })}
        >
          Link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            // Clearing a guess stores "no task" for everyone; an unlinked row is only hidden here.
            if (e.linkKind === 'inferred')
              link.mutate({ eid: e.id, taskId: null }, { onSuccess: props.onIgnore });
            else props.onIgnore();
          }}
        >
          Ignore
        </Button>
      </div>
      {link.isError && (
        <p role="alert" className="text-label text-danger">
          Couldn't save the link ({link.error.message}). Nothing changed.
        </p>
      )}
    </li>
  );
}

function AuthorRow(props: { author: UnknownAuthor; lookup: CodeLookup; wid: string }) {
  const a = props.author;
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const map = useMutation({
    mutationFn: () => api('mapAuthor', { params: { wid: props.wid }, body: { raw: a.raw, userId } }),
    // The server re-attributes past events and broadcasts them; refetch for clients without a socket.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['listActivity'] }),
  });
  const counts = [
    a.commits > 0 && `${a.commits} commit${a.commits === 1 ? '' : 's'}`,
    a.other > 0 && `${a.other} other event${a.other === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <p className="text-body text-default">
        {counts} by <span className="font-mono text-muted">{a.raw}</span>
        <span className="text-label text-subtle"> · last {ago(a.lastAt, props.lookup.now)}</span>
      </p>
      {map.isSuccess ? (
        <p role="status" className="text-label text-success">
          Mapped to {memberName(props.lookup.member(userId))}. Future activity from this author is attributed
          automatically.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Picker label={`Member for ${a.raw}`} value={userId} onChange={setUserId}>
            <option value="">Map to member…</option>
            {props.lookup.members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {memberName(m)} (@{m.user.githubLogin})
              </option>
            ))}
          </Picker>
          <Button size="sm" disabled={!userId} loading={map.isPending} onClick={() => map.mutate()}>
            Map author
          </Button>
        </div>
      )}
      {map.isError && (
        <p role="alert" className="text-label text-danger">
          Couldn't map this author ({map.error.message}). Nothing changed.
        </p>
      )}
    </li>
  );
}
