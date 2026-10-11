/**
 * S12 Code (DESIGN §8, T-407). The project's GitHub activity.
 * Layout: a compact repo header; the activity feed (grouped by day, slim filter toolbar) as the primary
 * column; a side column with "Needs attention" (unlinked queue + unknown authors, only when non-empty),
 * pull requests and active branches, all derived from the feed. The repo connection panel takes over only
 * when no repository is connected (or when changing it).
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
import { ago, firstName, memberName, midTruncate, useNow } from './mission-control/shared';
import { MemberAvatar, Picker } from './tasks/meta';
import { ErrorBox, ProjectGate, TaskLinkChip } from './page-states';
import { RepoConnection } from './code/RepoConnection';
import {
  NO_FILTERS,
  TYPE_FILTERS,
  branches as deriveBranches,
  filterFeed,
  groupByDay,
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
  return (
    <>
      {/* The shell breadcrumb names the page visually; the repo header is the visible title. */}
      <h1 className="sr-only">Code</h1>
      <CodeScreen key={pid} wid={wid} pid={pid} />
    </>
  );
}

function CodeScreen({ wid, pid }: { wid: string; pid: string }) {
  const now = useNow();
  const socket = useProjectSocket(pid);
  const [connecting, setConnecting] = useState(false);

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

  const lookup: CodeLookup = {
    now,
    tasks: board.data?.tasks ?? [],
    members: members.data ?? [],
    member: (id) => (id ? members.data?.find((m) => m.user.id === id) : undefined),
    task: (id) => (id ? board.data?.tasks.find((t) => t.id === id) : undefined),
  };

  const connected = project.isSuccess && repoId !== null;
  const showConnection = connecting || (project.isSuccess && repoId === null);

  return (
    <div className="flex min-h-full flex-col gap-7 p-7 max-sm:p-4">
      {project.isError && (
        <ErrorBox what="the project" error={project.error} onRetry={() => void project.refetch()} />
      )}
      {project.isPending && <ScreenSkeleton />}

      {connected && (
        <RepoHeader
          repo={repo}
          reposLoaded={repos.isSuccess}
          socket={socket}
          onChange={connecting ? undefined : () => setConnecting(true)}
        />
      )}

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

      {connected && (
        <CodeBody wid={wid} activity={activity} defaultBranch={repo?.defaultBranch ?? null} lookup={lookup} />
      )}
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const box = 'rounded-md border border-border bg-surface';

/** Quiet one-line empty state inside a side section (the house style for secondary lists). */
function QuietEmpty({ children }: { children: ReactNode }) {
  return <p className={cn(box, 'px-4 py-4 text-body text-subtle')}>{children}</p>;
}

function Pulse({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-raised', className)} />;
}

function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-busy="true" aria-label="Loading repository">
      <Pulse className="h-8 w-80 max-w-full" />
      <div className="grid gap-7 lg:grid-cols-(--grid-side-360)">
        <Pulse className="h-80" />
        <Pulse className="h-56" />
      </div>
    </div>
  );
}

/* ----------------------------- icons (decorative; every use sits next to words) ----------------------------- */

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
    >
      {children}
    </svg>
  );
}

const RepoIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3.5 13V3.5A1.5 1.5 0 0 1 5 2h7.5v9H5a1.5 1.5 0 0 0-1.5 1.5v0A1.5 1.5 0 0 0 5 14h7.5" />
  </Icon>
);
const BranchIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5" r="1.5" />
    <path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" />
  </Icon>
);
const CommitIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M1.5 8h4M10.5 8h4" />
  </Icon>
);
const PrIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="4" cy="4" r="1.5" />
    <circle cx="4" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <path d="M4 5.5v5M12 10.5V7a2 2 0 0 0-2-2H8" />
  </Icon>
);
const MergeIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="9" r="1.5" />
    <path d="M4 5v6M4 5c0 3 3 4 6.5 4" />
  </Icon>
);
const ReviewIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </Icon>
);
const CheckIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 8.5l3 3 7-7" />
  </Icon>
);
const AlertIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v0" />
  </Icon>
);

function KindIcon({ kind, className }: { kind: ActivityKind; className?: string }) {
  if (kind === 'commit') return <CommitIcon className={className} />;
  if (kind.startsWith('branch')) return <BranchIcon className={className} />;
  if (kind === 'pr_merged') return <MergeIcon className={className} />;
  if (kind === 'pr_review') return <ReviewIcon className={className} />;
  return <PrIcon className={className} />;
}

/* ----------------------------- repo header ----------------------------- */

function RepoHeader(props: {
  repo: { fullName: string; htmlUrl: string; defaultBranch: string; private: boolean } | undefined;
  reposLoaded: boolean;
  socket: { state: 'connecting' | 'open' | 'closed'; polling: boolean };
  onChange?: () => void;
}) {
  const { repo } = props;
  const [owner, name] = repo ? splitRepo(repo.fullName) : ['', ''];
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {repo ? (
        <a
          href={repo.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-2 rounded-xs text-title hover:text-strong"
          title="Open on GitHub"
        >
          <RepoIcon className="size-4 text-subtle" />
          <span className="min-w-0 truncate">
            <span className="text-muted">{owner}/</span>
            <span className="font-medium text-strong">{name}</span>
          </span>
        </a>
      ) : (
        <p className="flex items-center gap-2 text-body text-warning">
          <AlertIcon />
          {props.reposLoaded
            ? 'The connected repository is no longer visible to your GitHub installations.'
            : 'Loading repository…'}
        </p>
      )}

      {repo && (
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-subtle">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Default branch</dt>
            <BranchIcon />
            <dd className="font-mono text-muted">{repo.defaultBranch}</dd>
          </div>
          <div className="flex items-center gap-1.5" title="The Hakit GitHub App can see this repository">
            <dt className="sr-only">GitHub App</dt>
            <CheckIcon className="text-success" />
            <dd>App installed</dd>
          </div>
          <div>
            <dt className="sr-only">Visibility</dt>
            <dd>{repo.private ? 'Private' : 'Public'}</dd>
          </div>
        </dl>
      )}

      <div className="ml-auto flex items-center gap-3">
        <LiveStatus {...props.socket} />
        {props.onChange && (
          <Button size="sm" variant="ghost" onClick={props.onChange}>
            Change repository
          </Button>
        )}
      </div>
    </header>
  );
}

function splitRepo(fullName: string): [string, string] {
  const i = fullName.indexOf('/');
  return i < 0 ? ['', fullName] : [fullName.slice(0, i), fullName.slice(i + 1)];
}

function LiveStatus({ state, polling }: { state: 'connecting' | 'open' | 'closed'; polling: boolean }) {
  return state === 'open' ? (
    <span role="status" className="flex items-center gap-1.5 text-label text-subtle">
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      Live
    </span>
  ) : (
    <span role="status" className="text-label text-warning">
      {polling ? 'Reconnecting · updating every 10s' : 'Reconnecting…'}
    </span>
  );
}

/* ----------------------------- body ----------------------------- */

function CodeBody(props: {
  wid: string;
  activity: ActivityQuery;
  defaultBranch: string | null;
  lookup: CodeLookup;
}) {
  const { activity, lookup } = props;
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const events = useMemo(() => activity.data?.items ?? [], [activity.data]);
  const prs = useMemo(() => derivePullRequests(events), [events]);
  const branchRows = useMemo(
    () => deriveBranches(events, props.defaultBranch),
    [events, props.defaultBranch],
  );
  const queue = useMemo(() => unlinkedQueue(events, ignored), [events, ignored]);
  const authors = useMemo(() => unknownAuthors(events), [events]);
  const attention = activity.isSuccess && (queue.length > 0 || authors.length > 0);

  return (
    // Mobile: attention first, then the feed, then the lists. Desktop: feed left; attention + lists right.
    <div className="grid gap-7 lg:grid-cols-(--grid-side-360) lg:grid-rows-[auto_auto_1fr]">
      {attention && (
        <NeedsAttention
          className="lg:col-start-2 lg:row-start-1"
          queue={queue}
          authors={authors}
          lookup={lookup}
          wid={props.wid}
          onIgnore={(id) => setIgnored((s) => new Set(s).add(id))}
        />
      )}
      <ActivitySection
        className="min-w-0 lg:col-start-1 lg:row-span-3 lg:row-start-1"
        activity={activity}
        lookup={lookup}
      />
      <div
        className={cn(
          'flex min-w-0 flex-col gap-7 lg:col-start-2',
          attention ? 'lg:row-start-2' : 'lg:row-start-1',
        )}
      >
        {activity.isPending ? (
          <>
            <Pulse className="h-40" />
            <Pulse className="h-32" />
          </>
        ) : activity.isSuccess ? (
          <>
            <PullRequestList rows={prs} lookup={lookup} />
            <BranchList rows={branchRows} lookup={lookup} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------- activity feed ----------------------------- */

const LINK_FILTERS: Record<LinkFilter, string> = {
  all: 'Any link',
  confirmed: 'Confirmed links',
  inferred: 'Inferred links',
  none: 'Unlinked',
};

function ActivitySection(props: { className?: string; activity: ActivityQuery; lookup: CodeLookup }) {
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const all = props.activity.data?.items ?? [];
  const rows = filterFeed(all, filters);
  const github = all.filter((e) => e.source === 'github').length;
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const groups = groupByDay(rows, props.lookup.now);
  const clear = () => setFilters(NO_FILTERS);

  return (
    <section aria-labelledby="code-activity" className={props.className}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="code-activity" className="text-body-lg font-medium text-strong">
          Activity
        </h2>
        {props.activity.isSuccess && (
          <span className="text-body text-subtle">
            {filtered ? `${rows.length} of ${plural(github, 'event')}` : plural(github, 'event')}
          </span>
        )}
      </div>

      {props.activity.isSuccess && github > 0 && (
        <FilterBar filters={filters} onChange={setFilters} lookup={props.lookup} onClear={clear} />
      )}

      {props.activity.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading activity">
          {[0, 1, 2, 3].map((i) => (
            <Pulse key={i} className="h-14" />
          ))}
        </div>
      ) : props.activity.isError ? (
        <ErrorBox
          what="activity"
          error={props.activity.error ?? new Error('Unknown error')}
          onRetry={() => void props.activity.refetch()}
        />
      ) : rows.length === 0 ? (
        filtered ? (
          <div className={cn(box, 'flex flex-wrap items-center gap-3 px-4 py-4')}>
            <p className="text-body text-subtle">No activity matches these filters.</p>
            <Button size="sm" className="ml-auto" onClick={clear}>
              Clear filters
            </Button>
          </div>
        ) : (
          <div className={cn(box, 'flex items-start gap-3 px-5 py-6')}>
            <CommitIcon className="mt-0.5 size-4 text-subtle" />
            <div className="space-y-1">
              <p className="text-body text-default">No commits or pull requests yet.</p>
              <p className="text-body text-subtle">
                Push to the repository and activity shows up here within seconds. Name branches{' '}
                <span className="font-mono whitespace-nowrap text-muted">hk-&lt;number&gt;-…</span> to link
                work to a task.
              </p>
            </div>
          </div>
        )
      ) : (
        <div aria-live="polite" aria-relevant="additions" className="space-y-5">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="mb-2 text-label font-medium text-subtle">{g.label}</h3>
              <ol className={box}>
                {g.items.map((e) => (
                  <ActivityRow key={e.id} event={e} lookup={props.lookup} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function FilterBar(props: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  onClear: () => void;
  lookup: CodeLookup;
}) {
  const set = <K extends keyof FeedFilters>(k: K, v: FeedFilters[K]) =>
    props.onChange({ ...props.filters, [k]: v });
  const filtered = JSON.stringify(props.filters) !== JSON.stringify(NO_FILTERS);
  return (
    <div role="group" aria-label="Filter activity" className="mb-4 flex flex-wrap items-center gap-2">
      <Picker label="Type" value={props.filters.type} onChange={(v) => set('type', v as TypeFilter)}>
        {(Object.keys(TYPE_FILTERS) as TypeFilter[]).map((k) => (
          <option key={k} value={k}>
            {TYPE_FILTERS[k].label}
          </option>
        ))}
      </Picker>
      <Picker label="Member" value={props.filters.member} onChange={(v) => set('member', v)}>
        <option value="">Everyone</option>
        {props.lookup.members.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            {memberName(m)}
          </option>
        ))}
        <option value="unmapped">Unmapped authors</option>
      </Picker>
      <Picker label="Task" value={props.filters.task} onChange={(v) => set('task', v)}>
        <option value="">Any task</option>
        {props.lookup.tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.key} {midTruncate(t.title, 32)}
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
      {filtered && (
        <Button size="sm" variant="ghost" onClick={props.onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}

const VERB: Partial<Record<ActivityKind, string>> = {
  commit: 'committed',
  branch_created: 'created branch',
  branch_deleted: 'deleted branch',
  pr_opened: 'opened',
  pr_updated: 'updated',
  pr_merged: 'merged',
  pr_closed: 'closed',
  pr_review: 'reviewed',
};

/** Author name for a row: the member's first name, or the raw GitHub login/email (labelled unmapped). */
function Who({ userId, raw, lookup }: { userId: string | null; raw: string | null; lookup: CodeLookup }) {
  const m = lookup.member(userId);
  if (m) return <span className="text-default">{firstName(m)}</span>;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="truncate font-mono text-muted">{raw ?? 'Unknown'}</span>
      {raw && <span className="shrink-0 text-warning">(unmapped)</span>}
    </span>
  );
}

function Avatar({ userId, lookup }: { userId: string | null; lookup: CodeLookup }) {
  const m = lookup.member(userId);
  return m ? (
    <MemberAvatar member={m} className="size-6" />
  ) : (
    <span aria-hidden className="size-6 shrink-0 rounded-full border border-dashed border-border-strong" />
  );
}

/** +/− are measured by GitHub; the label keeps them readable without colour. */
function Diff({ additions, deletions }: { additions: number | null; deletions: number | null }) {
  if (additions === null) return null;
  const del = deletions ?? 0;
  return (
    <span
      className="font-mono"
      role="img"
      aria-label={`${additions} lines added, ${del} removed`}
      title="Lines changed (measured by GitHub)"
    >
      <span className="text-success">+{additions}</span> <span className="text-danger">−{del}</span>
    </span>
  );
}

function ActivityRow({ event: e, lookup }: { event: ActivityEvent; lookup: CodeLookup }) {
  const linked = e.linkKind !== 'none' && lookup.task(e.taskId);
  const pr = e.prNumber !== null && e.kind.startsWith('pr_') ? `#${e.prNumber}` : null;
  const title = e.url ? (
    <a href={e.url} target="_blank" rel="noreferrer" className="rounded-xs hover:text-strong">
      {e.title}
    </a>
  ) : (
    e.title
  );
  return (
    <li className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <Avatar userId={e.actorUserId} lookup={lookup} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-body text-default" title={e.title}>
            {title}
          </p>
          <time dateTime={e.ts} className="shrink-0 text-label text-subtle">
            {ago(e.ts, lookup.now)}
          </time>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-subtle">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <KindIcon kind={e.kind} />
            <Who userId={e.actorUserId} raw={e.actorRaw} lookup={lookup} />
            <span className="shrink-0">
              {VERB[e.kind] ?? 'updated'}
              {pr && ` ${pr}`}
            </span>
          </span>
          {e.ref && (
            <span className="truncate font-mono text-muted" title={e.ref}>
              {midTruncate(e.ref, 28)}
            </span>
          )}
          {e.kind === 'commit' && e.sha && <span className="font-mono">{e.sha.slice(0, 7)}</span>}
          <Diff additions={e.additions} deletions={e.deletions} />
          {linked && (
            <span className="ml-auto">
              <TaskLinkChip
                task={lookup.task(e.taskId)}
                linkKind={e.linkKind}
                confidence={e.linkConfidence}
              />
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/* ----------------------------- pull requests ----------------------------- */

const PR_STATE: Record<PrState, { label: string; className: string; icon: typeof PrIcon }> = {
  open: { label: 'Open', className: 'text-success', icon: PrIcon },
  merged: { label: 'Merged', className: 'text-accent-400', icon: MergeIcon },
  closed: { label: 'Closed', className: 'text-subtle', icon: PrIcon },
};

const PR_LIMIT = 6;

function PullRequestList({ rows, lookup }: { rows: PullRequestRow[]; lookup: CodeLookup }) {
  const [all, setAll] = useState(false);
  const open = rows.filter((p) => p.state === 'open');
  // Open first, then recently merged/closed (rows arrive newest first).
  const ordered = [...open, ...rows.filter((p) => p.state !== 'open')];
  const shown = all ? ordered : ordered.slice(0, Math.max(PR_LIMIT, open.length));
  return (
    <section aria-labelledby="code-prs">
      <SectionHeadId
        id="code-prs"
        title="Pull requests"
        meta={rows.length ? `${open.length} open` : undefined}
      />
      {rows.length === 0 ? (
        <QuietEmpty>
          No pull requests yet. Open one from an{' '}
          <span className="font-mono whitespace-nowrap text-muted">hk-&lt;number&gt;-…</span> branch and it
          links to that task.
        </QuietEmpty>
      ) : (
        <>
          <ul className={box}>
            {shown.map((pr) => (
              <PullRequestItem key={pr.number} pr={pr} lookup={lookup} />
            ))}
          </ul>
          {ordered.length > shown.length && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(true)}>
              Show {ordered.length - shown.length} more
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function PullRequestItem({ pr, lookup }: { pr: PullRequestRow; lookup: CodeLookup }) {
  const s = PR_STATE[pr.state];
  const StateIcon = s.icon;
  const title = (
    <>
      <span className="text-subtle">#{pr.number}</span> {pr.title}
    </>
  );
  return (
    <li className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <StateIcon className={cn('mt-0.5 size-4', s.className)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-default" title={pr.title}>
          {pr.url ? (
            <a href={pr.url} target="_blank" rel="noreferrer" className="rounded-xs hover:text-strong">
              {title}
            </a>
          ) : (
            title
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-subtle">
          <span className={s.className}>{s.label}</span>
          <span aria-hidden>·</span>
          <Who userId={pr.authorUserId} raw={pr.authorRaw} lookup={lookup} />
          <span aria-hidden>·</span>
          <Reviews pr={pr} />
          <span aria-hidden>·</span>
          <span>{ago(pr.updatedAt, lookup.now)}</span>
        </p>
      </div>
      {pr.linkKind !== 'none' && lookup.task(pr.taskId) && (
        <TaskLinkChip task={lookup.task(pr.taskId)} linkKind={pr.linkKind} confidence={pr.linkConfidence} />
      )}
    </li>
  );
}

function Reviews({ pr }: { pr: PullRequestRow }) {
  if (pr.reviews === 0) return <span>No reviews</span>;
  if (pr.changesRequested > 0)
    return <span className="text-danger">{plural(pr.changesRequested, 'change request')}</span>;
  return <span>{plural(pr.approvals, 'approval')}</span>;
}

/* ----------------------------- branches ----------------------------- */

function BranchList({ rows, lookup }: { rows: BranchRow[]; lookup: CodeLookup }) {
  const active = rows.filter((b) => !b.deleted);
  const deleted = rows.length - active.length;
  return (
    <section aria-labelledby="code-branches">
      <SectionHeadId
        id="code-branches"
        title="Active branches"
        meta={active.length ? String(active.length) : undefined}
      />
      {active.length === 0 ? (
        <QuietEmpty>Only the default branch has activity so far.</QuietEmpty>
      ) : (
        <ul className={box}>
          {active.map((b) => (
            <BranchItem key={b.name} b={b} lookup={lookup} />
          ))}
        </ul>
      )}
      {deleted > 0 && (
        <p className="mt-2 text-label text-subtle">
          {deleted} deleted branch{deleted === 1 ? '' : 'es'} not shown.
        </p>
      )}
      <p className="mt-2 text-label text-subtle">Ahead/behind counts aren't available from activity data.</p>
    </section>
  );
}

function BranchItem({ b, lookup }: { b: BranchRow; lookup: CodeLookup }) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <BranchIcon className="size-4 self-start text-subtle" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-body text-default" title={b.name}>
          {b.name}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-subtle">
          <Who userId={b.authorUserId} raw={b.authorRaw} lookup={lookup} />
          <span aria-hidden>·</span>
          <span title={b.commits ? plural(b.commits, 'commit') : undefined}>
            {ago(b.lastCommitAt ?? b.lastActivityAt, lookup.now)}
          </span>
          <span aria-hidden>·</span>
          {b.pr ? (
            <span className={PR_STATE[b.pr.state].className}>
              PR #{b.pr.number} {PR_STATE[b.pr.state].label.toLowerCase()}
            </span>
          ) : (
            <span>No PR</span>
          )}
        </p>
      </div>
      {b.linkKind !== 'none' && lookup.task(b.taskId) && (
        <TaskLinkChip task={lookup.task(b.taskId)} linkKind={b.linkKind} confidence={b.linkConfidence} />
      )}
    </li>
  );
}

function SectionHeadId(props: { id: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 id={props.id} className="text-body-lg font-medium text-strong">
        {props.title}
      </h2>
      {props.meta && <span className="text-body text-subtle">{props.meta}</span>}
    </div>
  );
}

/* ----------------------------- needs attention: unlinked queue + author mapping ----------------------------- */

const QUEUE_LIMIT = 4;

function NeedsAttention(props: {
  className?: string;
  queue: ActivityEvent[];
  authors: UnknownAuthor[];
  lookup: CodeLookup;
  wid: string;
  onIgnore: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const { queue, authors } = props;
  const shown = all ? queue : queue.slice(0, QUEUE_LIMIT);
  const total = queue.length + authors.length;
  return (
    <section aria-labelledby="code-attention" className={cn('min-w-0', props.className)}>
      <SectionHeadId id="code-attention" title="Needs attention" meta={plural(total, 'item')} />
      <div className={cn(box, 'overflow-hidden')}>
        {queue.length > 0 && (
          <div>
            <h3 className="border-b border-border px-4 py-2 text-label font-medium text-muted">
              Link to a task <span className="font-normal text-subtle">· {queue.length}</span>
            </h3>
            <ul>
              {shown.map((e) => (
                <UnlinkedRow
                  key={e.id}
                  event={e}
                  lookup={props.lookup}
                  onIgnore={() => props.onIgnore(e.id)}
                />
              ))}
            </ul>
            {queue.length > shown.length && (
              <div className="border-b border-border px-4 py-2">
                <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                  Show {queue.length - shown.length} more
                </Button>
              </div>
            )}
          </div>
        )}
        {authors.length > 0 && (
          <div>
            <h3 className="border-b border-border px-4 py-2 text-label font-medium text-muted">
              Unknown authors <span className="font-normal text-subtle">· {authors.length}</span>
            </h3>
            <ul>
              {authors.map((a) => (
                <AuthorRow key={a.raw} author={a} lookup={props.lookup} wid={props.wid} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
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

const row = 'space-y-2 border-b border-border px-4 py-3 last:border-b-0';

function UnlinkedRow(props: { event: ActivityEvent; lookup: CodeLookup; onIgnore: () => void }) {
  const e = props.event;
  const link = useLinkActivity();
  const [choice, setChoice] = useState('');
  const suggested = e.linkKind === 'inferred' ? props.lookup.task(e.taskId) : undefined;
  const busy = link.isPending;
  return (
    <li className={row}>
      <div className="flex min-w-0 items-baseline gap-2">
        <KindIcon kind={e.kind} className="self-center text-subtle" />
        <span className="sr-only">{VERB[e.kind] ?? 'activity'}:</span>
        <span className="min-w-0 flex-1 truncate text-body text-default" title={e.title}>
          {e.title}
        </span>
        <time dateTime={e.ts} className="shrink-0 text-label text-subtle">
          {ago(e.ts, props.lookup.now)}
        </time>
      </div>
      {suggested && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label text-subtle">Suggested</span>
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
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Picker label={`Choose a task for “${e.title}”`} value={choice} onChange={setChoice}>
          <option value="">{suggested ? 'Other task…' : 'Choose task…'}</option>
          {props.lookup.tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.key} {midTruncate(t.title, 32)}
            </option>
          ))}
        </Picker>
        {choice && (
          <Button
            size="sm"
            disabled={busy}
            loading={busy && link.variables?.taskId === choice}
            onClick={() => link.mutate({ eid: e.id, taskId: choice })}
          >
            Link
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
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
  const counts = [a.commits > 0 && plural(a.commits, 'commit'), a.other > 0 && plural(a.other, 'other event')]
    .filter(Boolean)
    .join(', ');
  return (
    <li className={row}>
      <p className="text-body text-default">
        <span className="font-mono text-muted">{a.raw}</span>
        <span className="text-label text-subtle">
          {' '}
          · {counts} · last {ago(a.lastAt, props.lookup.now)}
        </span>
      </p>
      {map.isSuccess ? (
        <p role="status" className="flex items-center gap-1.5 text-label text-success">
          <CheckIcon />
          Mapped to {memberName(props.lookup.member(userId))}. Future activity is attributed automatically.
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
