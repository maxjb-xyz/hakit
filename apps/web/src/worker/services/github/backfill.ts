/**
 * Backfill on connect (T-405): reads the last `sinceHours` of commits, branches and PRs through the GitHub
 * REST API with an installation token and turns them into the same NormalizedActivity rows webhooks produce.
 * Fetching is isolated in `githubBackfillClient`; `normalizeBackfill` is pure so it can be tested on fixtures.
 */
import { z } from 'zod';
import { GithubId, Timestamp } from '@hakit/contracts';
import type { GithubActor, NormalizedActivity } from './normalize';

const restUser = z.object({ id: GithubId, login: z.string() }).nullable();
export const RestCommit = z.object({
  sha: z.string().min(1),
  html_url: z.url(),
  commit: z.object({
    message: z.string(),
    author: z
      .object({ name: z.string().optional(), email: z.string().optional(), date: Timestamp })
      .nullable(),
  }),
  author: restUser.optional(),
  stats: z.object({ additions: z.number().int(), deletions: z.number().int() }).optional(),
});
export type RestCommit = z.infer<typeof RestCommit>;
export const RestBranch = z.object({ name: z.string().min(1), commit: z.object({ sha: z.string().min(1) }) });
export type RestBranch = z.infer<typeof RestBranch>;
export const RestPull = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.url(),
  user: restUser,
  head: z.object({ ref: z.string(), sha: z.string() }),
  created_at: Timestamp,
  updated_at: Timestamp,
  closed_at: Timestamp.nullable(),
  merged_at: Timestamp.nullable(),
});
export type RestPull = z.infer<typeof RestPull>;

/** What the backfill read from GitHub. Commits are keyed by the branch they were listed on. */
export interface BackfillSnapshot {
  repoId: number;
  defaultBranch: string;
  branches: RestBranch[];
  commitsByBranch: Record<string, RestCommit[]>;
  pulls: RestPull[];
}

const restActor = (c: RestCommit): GithubActor => ({
  ...(c.author ? { id: c.author.id, login: c.author.login } : {}),
  email: c.commit.author?.email ?? null,
  ...(c.commit.author?.name ? { name: c.commit.author.name } : {}),
});

/**
 * Pure: snapshot → activity, newest-independent ordering (default branch first, so a commit merged to the
 * default branch is attributed to it). Commits are deduped by sha; a branch other than the default yields one
 * `branch_created` at its earliest in-window commit; each PR yields `pr_opened` (if opened in the window) and
 * `pr_merged` / `pr_closed` (if that happened in the window).
 */
export function normalizeBackfill(s: BackfillSnapshot, since: string): NormalizedActivity[] {
  const sinceMs = Date.parse(since);
  const inWindow = (ts: string | null | undefined): ts is string => !!ts && Date.parse(ts) >= sinceMs;
  const out: NormalizedActivity[] = [];
  const make = (
    who: GithubActor | null,
    fields: Partial<NormalizedActivity['activity']> & Pick<NormalizedActivity['activity'], 'ts' | 'kind'>,
    linkText = '',
  ): NormalizedActivity => ({
    actor: who,
    linkText,
    activity: {
      source: 'github',
      repoId: s.repoId,
      ref: null,
      sha: null,
      prNumber: null,
      taskId: null,
      linkKind: 'none',
      linkConfidence: null,
      title: '',
      url: null,
      additions: null,
      deletions: null,
      agentSessionId: null,
      ...fields,
    },
  });

  const seen = new Set<string>();
  const branchNames = [
    s.defaultBranch,
    ...s.branches.map((b) => b.name).filter((n) => n !== s.defaultBranch),
  ].filter((n) => s.commitsByBranch[n]);
  for (const branch of branchNames) {
    const own: RestCommit[] = [];
    for (const c of s.commitsByBranch[branch] ?? []) {
      const ts = c.commit.author?.date;
      if (!inWindow(ts) || seen.has(c.sha)) continue;
      seen.add(c.sha);
      own.push(c);
      out.push(
        make(
          restActor(c),
          {
            kind: 'commit',
            ts: new Date(ts).toISOString(),
            ref: branch,
            sha: c.sha,
            title: c.commit.message.split(/\r?\n/)[0]!,
            url: c.html_url,
            additions: c.stats?.additions ?? null,
            deletions: c.stats?.deletions ?? null,
          },
          c.commit.message,
        ),
      );
    }
    if (branch !== s.defaultBranch && own.length) {
      const first = own.reduce((a, b) =>
        Date.parse(b.commit.author!.date) < Date.parse(a.commit.author!.date) ? b : a,
      );
      out.push(
        make(restActor(first), {
          kind: 'branch_created',
          ts: new Date(first.commit.author!.date).toISOString(),
          ref: branch,
          title: `Branch created: ${branch}`,
        }),
      );
    }
  }

  for (const pr of s.pulls) {
    const who: GithubActor | null = pr.user ? { id: pr.user.id, login: pr.user.login } : null;
    const text = `${pr.title}\n${pr.body ?? ''}`;
    const common = { ref: pr.head.ref, prNumber: pr.number, title: pr.title, url: pr.html_url };
    if (inWindow(pr.created_at))
      out.push(make(who, { ...common, kind: 'pr_opened', ts: new Date(pr.created_at).toISOString() }, text));
    if (inWindow(pr.merged_at))
      out.push(make(who, { ...common, kind: 'pr_merged', ts: new Date(pr.merged_at).toISOString() }, text));
    else if (inWindow(pr.closed_at))
      out.push(make(who, { ...common, kind: 'pr_closed', ts: new Date(pr.closed_at).toISOString() }, text));
  }
  return out.sort((a, b) => Date.parse(a.activity.ts) - Date.parse(b.activity.ts));
}

export class GithubBackfillError extends Error {
  constructor(
    message: string,
    /** False when retrying cannot help (e.g. the installation no longer exists). */
    readonly retryable = true,
  ) {
    super(message);
  }
}

/** Bounds keep one job within Workers' subrequest limits. */
export const BACKFILL_LIMITS = { branches: 30, commitPages: 3, pullPages: 3 } as const;

/** Installation-token REST reads. Never follows upstream URLs with the token; paths stay on api.github.com. */
export function githubBackfillClient(fetcher: typeof fetch = fetch) {
  async function call(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'Hakit',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GithubBackfillError('GitHub request failed');
    }
    if (response.status === 404 || response.status === 410)
      throw new GithubBackfillError(`GitHub returned ${response.status}`, false);
    if (!response.ok) throw new GithubBackfillError(`GitHub returned ${response.status}`);
    return response.json().catch(() => null);
  }
  async function list<T>(
    token: string,
    path: string,
    item: z.ZodType<T>,
    maxPages: number,
    stop?: (row: T) => boolean,
  ) {
    const rows: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const parsed = z.array(item).safeParse(await call(token, `${path}${sep}per_page=100&page=${page}`));
      if (!parsed.success) throw new GithubBackfillError('GitHub returned an invalid response');
      rows.push(...parsed.data);
      if (parsed.data.length < 100 || (stop && parsed.data.some(stop))) break;
    }
    return rows;
  }
  return {
    async installationToken(appJwt: string, installationId: number): Promise<string> {
      const parsed = z
        .object({ token: z.string().min(1) })
        .safeParse(
          await call(appJwt, `/app/installations/${installationId}/access_tokens`, { method: 'POST' }),
        );
      if (!parsed.success) throw new GithubBackfillError('GitHub returned an invalid installation token');
      return parsed.data.token;
    },
    async snapshot(
      token: string,
      repo: { id: number; fullName: string; defaultBranch: string },
      since: string,
    ): Promise<BackfillSnapshot> {
      const base = `/repos/${repo.fullName.split('/').map(encodeURIComponent).join('/')}`;
      const branches = (await list(token, `${base}/branches`, RestBranch, 1)).slice(
        0,
        BACKFILL_LIMITS.branches,
      );
      const names = [
        repo.defaultBranch,
        ...branches.map((b) => b.name).filter((n) => n !== repo.defaultBranch),
      ];
      const commitsByBranch: Record<string, RestCommit[]> = {};
      for (const name of names) {
        commitsByBranch[name] = await list(
          token,
          `${base}/commits?sha=${encodeURIComponent(name)}&since=${encodeURIComponent(since)}`,
          RestCommit,
          BACKFILL_LIMITS.commitPages,
        );
      }
      const sinceMs = Date.parse(since);
      const pulls = (
        await list(
          token,
          `${base}/pulls?state=all&sort=updated&direction=desc`,
          RestPull,
          BACKFILL_LIMITS.pullPages,
          (p) => Date.parse(p.updated_at) < sinceMs,
        )
      ).filter((p) => Date.parse(p.updated_at) >= sinceMs);
      return { repoId: repo.id, defaultBranch: repo.defaultBranch, branches, commitsByBranch, pulls };
    },
  };
}
export type GithubBackfillClient = ReturnType<typeof githubBackfillClient>;
