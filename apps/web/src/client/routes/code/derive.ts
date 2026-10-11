/**
 * Pure views over the activity feed for S12. The API has no branch or PR endpoints, so the tables are
 * derived from GitHub activity rows (commits, branch and PR events). Ahead/behind counts aren't in the
 * activity data and aren't shown.
 */
import type { ActivityEvent, ActivityKind, LinkKind } from '@hakit/contracts';

export type PrState = 'open' | 'merged' | 'closed';

export interface PullRequestRow {
  number: number;
  title: string;
  url: string | null;
  branch: string | null;
  state: PrState;
  authorUserId: string | null;
  authorRaw: string | null;
  approvals: number;
  changesRequested: number;
  reviews: number;
  /** Size from the latest PR event that carried it (measured by GitHub). */
  additions: number | null;
  deletions: number | null;
  updatedAt: string;
  /** Best link across the PR's events: confirmed beats inferred. */
  taskId: string | null;
  linkKind: LinkKind;
  linkConfidence: number | null;
}

export interface BranchRow {
  name: string;
  authorUserId: string | null;
  authorRaw: string | null;
  lastCommitAt: string | null;
  lastCommitSha: string | null;
  commits: number;
  deleted: boolean;
  pr: { number: number; state: PrState } | null;
  lastActivityAt: string;
  taskId: string | null;
  linkKind: LinkKind;
  linkConfidence: number | null;
}

const byTimeDesc = (a: { ts: string }, b: { ts: string }) => Date.parse(b.ts) - Date.parse(a.ts);
const isPr = (k: ActivityKind) => k.startsWith('pr_');

/** Prefer a confirmed link, then the most confident inferred one. Events must be newest first. */
function bestLink(events: ActivityEvent[]): Pick<BranchRow, 'taskId' | 'linkKind' | 'linkConfidence'> {
  const confirmed = events.find((e) => e.linkKind === 'confirmed' && e.taskId);
  if (confirmed) return { taskId: confirmed.taskId, linkKind: 'confirmed', linkConfidence: null };
  const inferred = events
    .filter((e) => e.linkKind === 'inferred' && e.taskId)
    .sort((a, b) => (b.linkConfidence ?? 0) - (a.linkConfidence ?? 0))[0];
  if (inferred)
    return { taskId: inferred.taskId, linkKind: 'inferred', linkConfidence: inferred.linkConfidence };
  return { taskId: null, linkKind: 'none', linkConfidence: null };
}

/** Reviews are stored as `PR #n review: <state>` (services/github/normalize). */
const reviewState = (title: string) => /review:\s*(\w+)/i.exec(title)?.[1]?.toLowerCase() ?? '';

export function pullRequests(events: ActivityEvent[]): PullRequestRow[] {
  const groups = new Map<number, ActivityEvent[]>();
  for (const e of events)
    if (e.source === 'github' && isPr(e.kind) && e.prNumber !== null)
      groups.set(e.prNumber, [...(groups.get(e.prNumber) ?? []), e]);
  return [...groups.entries()]
    .map(([number, list]) => {
      const sorted = [...list].sort(byTimeDesc);
      const lifecycle = sorted.filter((e) => e.kind !== 'pr_review');
      const latest = lifecycle[0];
      const opened = lifecycle.find((e) => e.kind === 'pr_opened') ?? latest ?? sorted[0]!;
      const reviews = sorted.filter((e) => e.kind === 'pr_review');
      const state: PrState =
        latest?.kind === 'pr_merged' ? 'merged' : latest?.kind === 'pr_closed' ? 'closed' : 'open';
      const sized = lifecycle.find((e) => e.additions !== null);
      return {
        number,
        title: (latest ?? opened).title,
        url: (latest ?? opened).url,
        branch: sorted.find((e) => e.ref)?.ref ?? null,
        state,
        authorUserId: opened.actorUserId,
        authorRaw: opened.actorRaw,
        approvals: reviews.filter((r) => reviewState(r.title) === 'approved').length,
        changesRequested: reviews.filter((r) => reviewState(r.title) === 'changes_requested').length,
        reviews: reviews.length,
        additions: sized?.additions ?? null,
        deletions: sized?.deletions ?? null,
        updatedAt: sorted[0]!.ts,
        ...bestLink(sorted),
      };
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function branches(events: ActivityEvent[], defaultBranch: string | null): BranchRow[] {
  const prs = pullRequests(events);
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events)
    if (e.source === 'github' && e.ref && e.ref !== defaultBranch)
      groups.set(e.ref, [...(groups.get(e.ref) ?? []), e]);
  return [...groups.entries()]
    .map(([name, list]) => {
      const sorted = [...list].sort(byTimeDesc);
      const commits = sorted.filter((e) => e.kind === 'commit');
      const head = commits[0];
      const who = head ?? sorted.find((e) => e.kind === 'branch_created') ?? sorted[0]!;
      const pr = prs.find((p) => p.branch === name);
      return {
        name,
        authorUserId: who.actorUserId,
        authorRaw: who.actorRaw,
        lastCommitAt: head?.ts ?? null,
        lastCommitSha: head?.sha ?? null,
        commits: commits.length,
        deleted: sorted[0]!.kind === 'branch_deleted',
        pr: pr ? { number: pr.number, state: pr.state } : null,
        lastActivityAt: sorted[0]!.ts,
        ...bestLink(sorted),
      };
    })
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
}

/* ----------------------------- filters ----------------------------- */

export const TYPE_FILTERS = {
  all: { label: 'All types', kinds: null },
  commit: { label: 'Commits', kinds: ['commit'] },
  branch: { label: 'Branches', kinds: ['branch_created', 'branch_deleted'] },
  pr: { label: 'Pull requests', kinds: ['pr_opened', 'pr_updated', 'pr_merged', 'pr_closed'] },
  review: { label: 'Reviews', kinds: ['pr_review'] },
} as const satisfies Record<string, { label: string; kinds: ActivityKind[] | null }>;
export type TypeFilter = keyof typeof TYPE_FILTERS;

export type LinkFilter = 'all' | 'confirmed' | 'inferred' | 'none';

export interface FeedFilters {
  member: string; // '' = everyone, 'unmapped' = authors not matched to a member
  type: TypeFilter;
  task: string; // '' = any
  link: LinkFilter;
}
export const NO_FILTERS: FeedFilters = { member: '', type: 'all', task: '', link: 'all' };

export function filterFeed(events: ActivityEvent[], f: FeedFilters): ActivityEvent[] {
  const kinds = TYPE_FILTERS[f.type].kinds as readonly ActivityKind[] | null;
  return events
    .filter((e) => e.source === 'github')
    .filter((e) =>
      f.member === '' ? true : f.member === 'unmapped' ? e.actorUserId === null : e.actorUserId === f.member,
    )
    .filter((e) => !kinds || kinds.includes(e.kind))
    .filter((e) => !f.task || e.taskId === f.task)
    .filter((e) => f.link === 'all' || e.linkKind === f.link)
    .sort(byTimeDesc);
}

/* ----------------------------- queues ----------------------------- */

/** GitHub activity that still needs a person: no task, or a guessed one. Inferred first, by confidence. */
export function unlinkedQueue(events: ActivityEvent[], ignored: ReadonlySet<string>): ActivityEvent[] {
  return events
    .filter((e) => e.source === 'github' && e.linkKind !== 'confirmed' && !ignored.has(e.id))
    .sort((a, b) =>
      a.linkKind !== b.linkKind
        ? a.linkKind === 'inferred'
          ? -1
          : 1
        : a.linkKind === 'inferred'
          ? (b.linkConfidence ?? 0) - (a.linkConfidence ?? 0)
          : byTimeDesc(a, b),
    );
}

export interface UnknownAuthor {
  raw: string;
  commits: number;
  other: number;
  lastAt: string;
}

/** "3 commits by jdoe@laptop.local": authors Hakit couldn't match to a member (INTEGRATIONS §1.7). */
export function unknownAuthors(events: ActivityEvent[]): UnknownAuthor[] {
  const map = new Map<string, UnknownAuthor>();
  for (const e of events) {
    if (e.source !== 'github' || e.actorUserId !== null || !e.actorRaw) continue;
    const cur = map.get(e.actorRaw) ?? { raw: e.actorRaw, commits: 0, other: 0, lastAt: e.ts };
    if (e.kind === 'commit') cur.commits++;
    else cur.other++;
    if (Date.parse(e.ts) > Date.parse(cur.lastAt)) cur.lastAt = e.ts;
    map.set(e.actorRaw, cur);
  }
  return [...map.values()].sort((a, b) => b.commits + b.other - (a.commits + a.other));
}

/* ----------------------------- day groups ----------------------------- */

export interface DayGroup<T> {
  /** Local calendar day, `YYYY-MM-DD`. */
  key: string;
  label: string;
  items: T[];
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Splits a newest-first feed into local-day buckets labelled Today / Yesterday / "Mon, Oct 6". */
export function groupByDay<T extends { ts: string }>(items: T[], now: number): DayGroup<T>[] {
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const names: Record<string, string> = { [dayKey(today)]: 'Today', [dayKey(yesterday)]: 'Yesterday' };
  const out: DayGroup<T>[] = [];
  for (const item of items) {
    const d = new Date(item.ts);
    const key = dayKey(d);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      g = {
        key,
        label: names[key] ?? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
        items: [],
      };
      out.push(g);
    }
    g.items.push(item);
  }
  return out;
}
