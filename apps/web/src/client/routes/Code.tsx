/**
 * S12 Code (DESIGN §8, T-407). The project's GitHub activity.
 * Layout: a compact repo header; the activity feed (grouped by day, slim filter toolbar) as the primary
 * column; a side column with "Needs attention" (unlinked queue + unknown authors, only when non-empty),
 * pull requests and active branches, all derived from the feed. The repo connection panel takes over only
 * when no repository is connected (or when changing it).
 * Everything that names something on GitHub links there (commit, PR, branch, repo; new tab); people link to
 * their profile, tasks to the task inspector. Rows are whole-row clickable through one `row-link`.
 * Live: the project socket invalidates `listActivity` on `activity.created`.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEvent, ActivityKind, Member, Page, Task } from '@hakit/contracts';
import { Avatar, Button, TickNumber, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProject } from '../lib/project';
import { useProjectSocket } from '../lib/ws';
import { ago, firstName, memberName, midTruncate, useNow } from './mission-control/shared';
import { ErrorBox, ProjectGate, TaskLinkChip } from './page-states';
import { RepoConnection } from './code/RepoConnection';
import {
  NO_FILTERS,
  TYPE_FILTERS,
  branches as deriveBranches,
  commitUrl,
  eventUrl,
  filterFeed,
  groupByDay,
  looksLikeLogin,
  pullRequests as derivePullRequests,
  pullUrl,
  repoBase,
  treeUrl,
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
    wid,
    base: repoBase(repo),
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
        <div className="animate-fade-in">
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
        </div>
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
  wid: string;
  /** `https://github.com/<owner>/<repo>` of the connected repo, for deriving commit / PR / branch links. */
  base: string | null;
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
const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

const box = 'rounded-md border border-border bg-surface';
/** A list row: whole row clickable through its `row-link`, hairline between rows. */
const rowBase = 'group border-b border-border last:border-b-0';
/** Secondary links inside a clickable row sit above the stretched row link. */
const inner = 'relative z-1 rounded-xs';

/** Quiet one-line empty state inside a side section (the house style for secondary lists). */
function QuietEmpty({ children }: { children: ReactNode }) {
  return <p className={cn(box, 'animate-fade-in px-4 py-4 text-body text-subtle')}>{children}</p>;
}

function Bone({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-busy="true" aria-label="Loading repository">
      <Bone className="h-8 w-80 max-w-full" />
      <div className="grid gap-7 lg:grid-cols-(--grid-side-360)">
        <Bone className="h-80" />
        <Bone className="h-56" />
      </div>
    </div>
  );
}

/** A link to GitHub: new tab, no opener, and it says so to screen readers. */
function GitHubLink(props: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
  /** Show the ↗ glyph always (default: only on hover / focus of the enclosing row or link). */
  icon?: 'always' | 'hover' | 'none';
}) {
  const icon = props.icon ?? 'hover';
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      title={props.title}
      className={cn('group/ext', props.className)}
    >
      {props.children}
      {icon !== 'none' && (
        <ExternalIcon
          className={cn(
            'ml-1 inline-block size-3 align-[-1px] text-subtle transition-opacity duration-(--duration-fast)',
            icon === 'hover' &&
              'opacity-0 group-hover:opacity-100 group-hover/ext:opacity-100 group-focus-visible/ext:opacity-100',
          )}
        />
      )}
      <span className="sr-only"> (opens GitHub in a new tab)</span>
    </a>
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
const ExternalIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5L7.5 8.5" />
  </Icon>
);
const LinkIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />
  </Icon>
);
const PersonIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" />
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
  const base = repoBase(repo);
  return (
    <header className="flex animate-fade-in flex-wrap items-center gap-x-5 gap-y-2">
      {repo ? (
        <GitHubLink
          href={repo.htmlUrl}
          title={`Open ${repo.fullName} on GitHub`}
          className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-0.5 text-title transition-colors duration-(--duration-instant) hover:bg-hover"
        >
          <RepoIcon className="size-4 text-subtle" />
          <span className="min-w-0 truncate">
            <span className="text-muted">{owner}/</span>
            <span className="font-medium text-strong">{name}</span>
          </span>
        </GitHubLink>
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
          <div className="flex items-center">
            <dt className="sr-only">Default branch</dt>
            <dd>
              <GitHubLink
                href={treeUrl(base, repo.defaultBranch) ?? repo.htmlUrl}
                title={`Browse ${repo.defaultBranch} on GitHub`}
                icon="none"
                className="interactive inline-flex items-center gap-1.5 rounded-xs px-1 font-mono text-muted"
              >
                <BranchIcon />
                {repo.defaultBranch}
              </GitHubLink>
            </dd>
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
      <span aria-hidden className="relative flex size-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
        <span className="relative size-1.5 rounded-full bg-success" />
      </span>
      Live
    </span>
  ) : (
    <span role="status" className="animate-fade-in text-label text-warning">
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
          <div
            className="flex flex-col gap-7"
            aria-busy="true"
            aria-label="Loading pull requests and branches"
          >
            <Bone className="h-40" />
            <Bone className="h-32" />
          </div>
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
  // Running index across day groups so the stagger reads top to bottom.
  let n = 0;

  return (
    <section aria-labelledby="code-activity" className={props.className}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="code-activity" className="text-body-lg font-medium text-strong">
          Activity
        </h2>
        {props.activity.isSuccess && (
          <span className="text-body text-subtle">
            {filtered ? (
              <>
                <TickNumber value={rows.length} /> of {plural(github, 'event')}
              </>
            ) : (
              plural(github, 'event')
            )}
          </span>
        )}
      </div>

      {props.activity.isSuccess && github > 0 && (
        <FilterBar filters={filters} onChange={setFilters} lookup={props.lookup} onClear={clear} />
      )}

      {props.activity.isPending ? (
        <div className={cn(box, 'overflow-hidden')} aria-busy="true" aria-label="Loading activity">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <Bone className="size-6 rounded-full" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-3/5 rounded-sm" />
                <Bone className="h-3 w-2/5 rounded-sm" />
              </div>
            </div>
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
          <div className={cn(box, 'flex animate-fade-in flex-wrap items-center gap-3 px-4 py-4')}>
            <p className="text-body text-subtle">No activity matches these filters.</p>
            <Button size="sm" className="ml-auto" onClick={clear}>
              Clear filters
            </Button>
          </div>
        ) : (
          <div className={cn(box, 'flex animate-fade-in items-start gap-3 px-5 py-6')}>
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
              <h3 className="mb-2 flex items-center gap-2.5 text-label text-subtle">
                <span className="font-medium text-muted">{g.label}</span>
                <span>{plural(g.items.length, 'event')}</span>
                <span aria-hidden className="h-px flex-1 bg-border" />
              </h3>
              <ol className={cn(box, 'overflow-hidden')}>
                {g.items.map((e) => (
                  <ActivityRow key={e.id} event={e} lookup={props.lookup} index={n++} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** A filter select styled as a toolbar chip; it lights up while it narrows the feed. */
function FilterSelect(props: {
  label: string;
  value: string;
  active: boolean;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex min-w-0">
      <span className="sr-only">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={cn(
          'field h-control-sm max-w-full cursor-pointer appearance-none truncate rounded-full pr-6 pl-2.5 text-label',
          props.active && 'border-accent-400 bg-accent-a12 text-strong',
        )}
      >
        {props.children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-caption text-subtle"
      >
        ▾
      </span>
    </label>
  );
}

function FilterBar(props: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  onClear: () => void;
  lookup: CodeLookup;
}) {
  const f = props.filters;
  const set = <K extends keyof FeedFilters>(k: K, v: FeedFilters[K]) => props.onChange({ ...f, [k]: v });
  const active = (Object.keys(NO_FILTERS) as (keyof FeedFilters)[]).filter((k) => f[k] !== NO_FILTERS[k]);
  return (
    <div
      role="group"
      aria-label="Filter activity"
      className="mb-4 flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-2"
    >
      <FilterSelect
        label="Type"
        value={f.type}
        active={f.type !== 'all'}
        onChange={(v) => set('type', v as TypeFilter)}
      >
        {(Object.keys(TYPE_FILTERS) as TypeFilter[]).map((k) => (
          <option key={k} value={k}>
            {TYPE_FILTERS[k].label}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Member"
        value={f.member}
        active={f.member !== ''}
        onChange={(v) => set('member', v)}
      >
        <option value="">Everyone</option>
        {props.lookup.members.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            {memberName(m)}
          </option>
        ))}
        <option value="unmapped">Unmapped authors</option>
      </FilterSelect>
      <FilterSelect label="Task" value={f.task} active={f.task !== ''} onChange={(v) => set('task', v)}>
        <option value="">Any task</option>
        {props.lookup.tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.key} {midTruncate(t.title, 32)}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Link"
        value={f.link}
        active={f.link !== 'all'}
        onChange={(v) => set('link', v as LinkFilter)}
      >
        {(Object.keys(LINK_FILTERS) as LinkFilter[]).map((k) => (
          <option key={k} value={k}>
            {LINK_FILTERS[k]}
          </option>
        ))}
      </FilterSelect>
      {active.length > 0 && (
        <Button size="sm" variant="ghost" className="animate-fade-in" onClick={props.onClear}>
          Clear {active.length > 1 ? `${active.length} filters` : 'filter'}
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

/**
 * Author name for a row: the member's first name linking to their profile, or the raw GitHub login/email
 * (labelled unmapped; a login links to the GitHub profile).
 */
function Who({ userId, raw, lookup }: { userId: string | null; raw: string | null; lookup: CodeLookup }) {
  const m = lookup.member(userId);
  if (m)
    return (
      <Link
        to={`/w/${lookup.wid}/team/${m.user.id}`}
        title={`${memberName(m)}'s profile`}
        className={cn(inner, 'text-default underline-offset-2 hover:text-strong hover:underline')}
      >
        {firstName(m)}
      </Link>
    );
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      {looksLikeLogin(raw) ? (
        <GitHubLink
          href={`https://github.com/${encodeURIComponent(raw)}`}
          title={`@${raw} on GitHub`}
          icon="none"
          className={cn(
            inner,
            'truncate font-mono text-muted underline-offset-2 hover:text-strong hover:underline',
          )}
        >
          {raw}
        </GitHubLink>
      ) : (
        <span className="truncate font-mono text-muted">{raw ?? 'Unknown'}</span>
      )}
      {raw && <span className="shrink-0 text-warning">(unmapped)</span>}
    </span>
  );
}

/** GitHub picture for members and for unmapped logins; a dashed ring for authors we only know by email. */
function AuthorPic({
  userId,
  raw,
  lookup,
}: {
  userId: string | null;
  raw: string | null;
  lookup: CodeLookup;
}) {
  const m = lookup.member(userId);
  if (m)
    return (
      <Avatar
        decorative
        name={memberName(m)}
        avatarUrl={m.user.avatarUrl}
        login={m.user.githubLogin}
        colorIndex={m.colorIndex}
      />
    );
  if (looksLikeLogin(raw)) return <Avatar decorative name={raw} login={raw} />;
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-subtle"
    >
      <PersonIcon className="size-3" />
    </span>
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

function ActivityRow({
  event: e,
  lookup,
  index,
}: {
  event: ActivityEvent;
  lookup: CodeLookup;
  index: number;
}) {
  const linked = e.linkKind !== 'none' && lookup.task(e.taskId);
  const href = eventUrl(e, lookup.base);
  const prHref = e.prNumber !== null && e.kind.startsWith('pr_') ? pullUrl(lookup.base, e.prNumber) : null;
  const shaHref = e.kind === 'commit' ? (commitUrl(lookup.base, e.sha) ?? e.url) : null;
  const refHref = e.kind === 'branch_deleted' ? null : treeUrl(lookup.base, e.ref);
  const what = e.kind === 'commit' ? 'commit' : e.kind.startsWith('pr_') ? 'pull request' : 'branch';
  return (
    <li
      className={cn(rowBase, 'flex animate-list-in gap-3 px-4 py-3', href && 'row-interactive')}
      style={stagger(index)}
    >
      <AuthorPic userId={e.actorUserId} raw={e.actorRaw} lookup={lookup} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-body text-default" title={e.title}>
            {href ? (
              <GitHubLink
                href={href}
                title={`Open this ${what} on GitHub`}
                className="row-link group-hover:text-strong"
              >
                {e.title}
              </GitHubLink>
            ) : (
              e.title
            )}
          </p>
          <time
            dateTime={e.ts}
            title={new Date(e.ts).toLocaleString()}
            className="shrink-0 text-label text-subtle"
          >
            {ago(e.ts, lookup.now)}
          </time>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-subtle">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <KindIcon kind={e.kind} />
            <Who userId={e.actorUserId} raw={e.actorRaw} lookup={lookup} />
            <span className="shrink-0">
              {VERB[e.kind] ?? 'updated'}
              {e.prNumber !== null && e.kind.startsWith('pr_') && (
                <>
                  {' '}
                  {prHref ? (
                    <GitHubLink
                      href={prHref}
                      icon="none"
                      title={`Pull request #${e.prNumber} on GitHub`}
                      className={cn(inner, 'text-muted hover:text-strong hover:underline')}
                    >
                      #{e.prNumber}
                    </GitHubLink>
                  ) : (
                    `#${e.prNumber}`
                  )}
                </>
              )}
            </span>
          </span>
          {e.ref &&
            (refHref ? (
              <GitHubLink
                href={refHref}
                icon="none"
                title={`Branch ${e.ref} on GitHub`}
                className={cn(inner, 'interactive inline-flex max-w-full truncate px-1 font-mono text-muted')}
              >
                {midTruncate(e.ref, 28)}
              </GitHubLink>
            ) : (
              <span className="truncate font-mono text-muted line-through decoration-subtle" title={e.ref}>
                {midTruncate(e.ref, 28)}
              </span>
            ))}
          {e.kind === 'commit' &&
            e.sha &&
            (shaHref ? (
              <GitHubLink
                href={shaHref}
                icon="none"
                title={`Commit ${e.sha.slice(0, 7)} on GitHub`}
                className={cn(inner, 'interactive px-1 font-mono text-muted')}
              >
                {e.sha.slice(0, 7)}
              </GitHubLink>
            ) : (
              <span className="font-mono">{e.sha.slice(0, 7)}</span>
            ))}
          <Diff additions={e.additions} deletions={e.deletions} />
          {linked && (
            <span className="relative z-1 ml-auto">
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
        href={lookup.base ? `${lookup.base}/pulls` : undefined}
        hrefLabel="All on GitHub"
      />
      {rows.length === 0 ? (
        <QuietEmpty>
          No pull requests yet. Open one from an{' '}
          <span className="font-mono whitespace-nowrap text-muted">hk-&lt;number&gt;-…</span> branch and it
          links to that task.
        </QuietEmpty>
      ) : (
        <>
          <ul className={cn(box, 'overflow-hidden')}>
            {shown.map((pr, i) => (
              <PullRequestItem key={pr.number} pr={pr} lookup={lookup} index={i} />
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

function PullRequestItem({ pr, lookup, index }: { pr: PullRequestRow; lookup: CodeLookup; index: number }) {
  const s = PR_STATE[pr.state];
  const StateIcon = s.icon;
  const href = pr.url ?? pullUrl(lookup.base, pr.number);
  const title = (
    <>
      <span className="text-subtle">#{pr.number}</span> {pr.title}
    </>
  );
  return (
    <li
      className={cn(rowBase, 'flex animate-list-in gap-3 px-4 py-3', href && 'row-interactive')}
      style={stagger(index)}
    >
      <StateIcon className={cn('mt-0.5 size-4', s.className)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-default" title={pr.title}>
          {href ? (
            <GitHubLink
              href={href}
              title={`Pull request #${pr.number} on GitHub`}
              className="row-link group-hover:text-strong"
            >
              {title}
            </GitHubLink>
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
        <span className="relative z-1 self-start">
          <TaskLinkChip task={lookup.task(pr.taskId)} linkKind={pr.linkKind} confidence={pr.linkConfidence} />
        </span>
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
        href={lookup.base ? `${lookup.base}/branches` : undefined}
        hrefLabel="All on GitHub"
      />
      {active.length === 0 ? (
        <QuietEmpty>Only the default branch has activity so far.</QuietEmpty>
      ) : (
        <ul className={cn(box, 'overflow-hidden')}>
          {active.map((b, i) => (
            <BranchItem key={b.name} b={b} lookup={lookup} index={i} />
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

function BranchItem({ b, lookup, index }: { b: BranchRow; lookup: CodeLookup; index: number }) {
  const href = treeUrl(lookup.base, b.name);
  const prHref = b.pr ? pullUrl(lookup.base, b.pr.number) : null;
  const headHref = commitUrl(lookup.base, b.lastCommitSha);
  return (
    <li
      className={cn(rowBase, 'flex animate-list-in items-center gap-3 px-4 py-3', href && 'row-interactive')}
      style={stagger(index)}
    >
      <BranchIcon className="size-4 self-start text-subtle" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-body text-default" title={b.name}>
          {href ? (
            <GitHubLink
              href={href}
              title={`Branch ${b.name} on GitHub`}
              className="row-link group-hover:text-strong"
            >
              {b.name}
            </GitHubLink>
          ) : (
            b.name
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-subtle">
          <Who userId={b.authorUserId} raw={b.authorRaw} lookup={lookup} />
          <span aria-hidden>·</span>
          {headHref && b.lastCommitSha ? (
            <GitHubLink
              href={headHref}
              icon="none"
              title={`Latest commit ${b.lastCommitSha.slice(0, 7)} on GitHub`}
              className={cn(inner, 'hover:text-strong hover:underline')}
            >
              {ago(b.lastCommitAt ?? b.lastActivityAt, lookup.now)}
            </GitHubLink>
          ) : (
            <span title={b.commits ? plural(b.commits, 'commit') : undefined}>
              {ago(b.lastCommitAt ?? b.lastActivityAt, lookup.now)}
            </span>
          )}
          <span aria-hidden>·</span>
          {b.pr ? (
            prHref ? (
              <GitHubLink
                href={prHref}
                icon="none"
                title={`Pull request #${b.pr.number} on GitHub`}
                className={cn(inner, PR_STATE[b.pr.state].className, 'hover:underline')}
              >
                PR #{b.pr.number} {PR_STATE[b.pr.state].label.toLowerCase()}
              </GitHubLink>
            ) : (
              <span className={PR_STATE[b.pr.state].className}>
                PR #{b.pr.number} {PR_STATE[b.pr.state].label.toLowerCase()}
              </span>
            )
          ) : (
            <span>No PR</span>
          )}
        </p>
      </div>
      {b.linkKind !== 'none' && lookup.task(b.taskId) && (
        <span className="relative z-1">
          <TaskLinkChip task={lookup.task(b.taskId)} linkKind={b.linkKind} confidence={b.linkConfidence} />
        </span>
      )}
    </li>
  );
}

function SectionHeadId(props: {
  id: string;
  title: string;
  meta?: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 id={props.id} className="text-body-lg font-medium text-strong">
        {props.title}
      </h2>
      {props.meta && <span className="text-body text-subtle">{props.meta}</span>}
      {props.href && (
        <GitHubLink
          href={props.href}
          icon="always"
          className="interactive ml-auto rounded-xs px-1 text-label text-subtle"
        >
          {props.hrefLabel}
        </GitHubLink>
      )}
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
    <section aria-labelledby="code-attention" className={cn('min-w-0 animate-fade-in', props.className)}>
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 id="code-attention" className="flex items-center gap-2 text-body-lg font-medium text-strong">
          <AlertIcon className="text-warning" />
          Needs attention
        </h2>
        <span className="text-body text-subtle">
          <TickNumber value={total} label={plural(total, 'item')} /> {total === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className={cn(box, 'overflow-hidden')}>
        {queue.length > 0 && (
          <div>
            <h3 className="flex items-center gap-1.5 border-b border-border bg-raised px-4 py-2 text-label font-medium text-muted">
              <LinkIcon className="size-3 text-subtle" />
              Link to a task <span className="font-normal text-subtle">· {queue.length}</span>
            </h3>
            <ul>
              {shown.map((e, i) => (
                <UnlinkedRow
                  key={e.id}
                  index={i}
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
            <h3 className="flex items-center gap-1.5 border-b border-border bg-raised px-4 py-2 text-label font-medium text-muted">
              <PersonIcon className="size-3 text-subtle" />
              Unknown authors <span className="font-normal text-subtle">· {authors.length}</span>
            </h3>
            <ul>
              {authors.map((a, i) => (
                <AuthorRow key={a.raw} index={i} author={a} lookup={props.lookup} wid={props.wid} />
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

const row = 'animate-list-in space-y-2 border-b border-border px-4 py-3 last:border-b-0';

function UnlinkedRow(props: {
  event: ActivityEvent;
  lookup: CodeLookup;
  onIgnore: () => void;
  index: number;
}) {
  const e = props.event;
  const link = useLinkActivity();
  const [choice, setChoice] = useState('');
  const suggested = e.linkKind === 'inferred' ? props.lookup.task(e.taskId) : undefined;
  const busy = link.isPending;
  const href = eventUrl(e, props.lookup.base);
  return (
    <li
      className={cn(row, busy && 'opacity-70 transition-opacity duration-(--duration-fast)')}
      style={stagger(props.index)}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <KindIcon kind={e.kind} className="self-center text-subtle" />
        <span className="sr-only">{VERB[e.kind] ?? 'activity'}:</span>
        <span className="min-w-0 flex-1 truncate text-body text-default" title={e.title}>
          {href ? (
            <GitHubLink
              href={href}
              className="rounded-xs underline-offset-2 hover:text-strong hover:underline"
            >
              {e.title}
            </GitHubLink>
          ) : (
            e.title
          )}
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
        <FilterSelect
          label={`Choose a task for “${e.title}”`}
          value={choice}
          active={false}
          onChange={setChoice}
        >
          <option value="">{suggested ? 'Other task…' : 'Choose task…'}</option>
          {props.lookup.tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.key} {midTruncate(t.title, 32)}
            </option>
          ))}
        </FilterSelect>
        {choice && (
          <Button
            size="sm"
            className="animate-pop-in"
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
        <p role="alert" className="animate-fade-in text-label text-danger">
          Couldn't save the link ({link.error.message}). Nothing changed.
        </p>
      )}
    </li>
  );
}

function AuthorRow(props: { author: UnknownAuthor; lookup: CodeLookup; wid: string; index: number }) {
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
    <li className={row} style={stagger(props.index)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <AuthorPic userId={null} raw={a.raw} lookup={props.lookup} />
        <p className="min-w-0 text-body text-default">
          {looksLikeLogin(a.raw) ? (
            <GitHubLink
              href={`https://github.com/${encodeURIComponent(a.raw)}`}
              className="rounded-xs font-mono text-muted hover:text-strong hover:underline"
            >
              {a.raw}
            </GitHubLink>
          ) : (
            <span className="font-mono text-muted">{a.raw}</span>
          )}
          <span className="text-label text-subtle">
            {' '}
            · {counts} · last {ago(a.lastAt, props.lookup.now)}
          </span>
        </p>
      </div>
      {map.isSuccess ? (
        <p role="status" className="flex animate-fade-in items-center gap-1.5 text-label text-success">
          <CheckIcon />
          Mapped to {memberName(props.lookup.member(userId))}. Future activity is attributed automatically.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label={`Member for ${a.raw}`} value={userId} active={false} onChange={setUserId}>
            <option value="">Map to member…</option>
            {props.lookup.members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {memberName(m)} (@{m.user.githubLogin})
              </option>
            ))}
          </FilterSelect>
          <Button size="sm" disabled={!userId} loading={map.isPending} onClick={() => map.mutate()}>
            Map author
          </Button>
        </div>
      )}
      {map.isError && (
        <p role="alert" className="animate-fade-in text-label text-danger">
          Couldn't map this author ({map.error.message}). Nothing changed.
        </p>
      )}
    </li>
  );
}
