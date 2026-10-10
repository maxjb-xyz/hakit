import { z } from 'zod';
import { GithubId, Timestamp, type ActivityEvent } from '@hakit/contracts';

const actor = z.object({
  id: GithubId.optional(),
  login: z.string().optional(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  name: z.string().optional(),
});
export type GithubActor = z.infer<typeof actor>;
const base = z.object({ repository: z.object({ id: GithubId }), sender: actor.optional() });
const commit = z.object({
  id: z.string().min(1),
  message: z.string(),
  timestamp: Timestamp,
  url: z.url(),
  author: actor,
});
const push = base.extend({
  ref: z.string(),
  created: z.boolean(),
  deleted: z.boolean(),
  commits: z.array(commit),
});
const refEvent = base.extend({ ref: z.string(), ref_type: z.string() });
const pr = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  html_url: z.url(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  updated_at: Timestamp,
  merged: z.boolean().optional(),
  merged_at: Timestamp.nullable().optional(),
  closed_at: Timestamp.nullable().optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});
const pullRequest = base.extend({ action: z.string(), pull_request: pr });
const reviewEvent = pullRequest.extend({
  review: z.object({
    user: actor,
    state: z.string(),
    submitted_at: Timestamp,
    html_url: z.url(),
  }),
});

export interface NormalizedActivity {
  actor: GithubActor | null;
  activity: Omit<ActivityEvent, 'id' | 'projectId' | 'actorUserId' | 'actorRaw'>;
}

/** Pure conversion: time for events without a timestamp comes from the delivery ledger. */
export function normalizeGithub(event: string, payload: unknown, receivedAt: string): NormalizedActivity[] {
  const make = (
    repoId: number,
    who: GithubActor | null,
    fields: Partial<NormalizedActivity['activity']>,
  ): NormalizedActivity => ({
    actor: who,
    activity: {
      ts: receivedAt,
      source: 'github',
      kind: 'commit',
      repoId,
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
  if (event === 'push') {
    const p = push.parse(payload);
    const result = p.deleted
      ? []
      : [...new Map(p.commits.map((c) => [c.id, c])).values()].map((c) =>
          make(p.repository.id, c.author, {
            kind: 'commit',
            ts: new Date(c.timestamp).toISOString(),
            ref: p.ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, ''),
            sha: c.id,
            title: c.message.split(/\r?\n/)[0]!,
            url: c.url,
          }),
        );
    if (p.created && p.ref.startsWith('refs/heads/'))
      result.push(
        make(p.repository.id, p.sender ?? null, {
          kind: 'branch_created',
          ref: p.ref.slice(11),
          title: `Branch created: ${p.ref.slice(11)}`,
        }),
      );
    return result;
  }
  if (event === 'create' || event === 'delete') {
    const p = refEvent.parse(payload);
    return p.ref_type !== 'branch'
      ? []
      : [
          make(p.repository.id, p.sender ?? null, {
            kind: event === 'create' ? 'branch_created' : 'branch_deleted',
            ref: p.ref,
            title: `Branch ${event === 'create' ? 'created' : 'deleted'}: ${p.ref}`,
          }),
        ];
  }
  if (event === 'pull_request' || event === 'pull_request_review') {
    const p = pullRequest.parse(payload);
    if (event === 'pull_request_review') {
      if (p.action !== 'submitted') return [];
      const r = reviewEvent.parse(payload).review;
      return [
        make(p.repository.id, r.user, {
          kind: 'pr_review',
          ts: r.submitted_at,
          ref: p.pull_request.head.ref,
          // Reserve sha for commit rows: the existing dedupe index also covers PR kinds.
          // Separate reviews of the same head SHA can legitimately share a timestamp.
          sha: null,
          prNumber: p.pull_request.number,
          title: `PR #${p.pull_request.number} review: ${r.state}`,
          url: r.html_url,
        }),
      ];
    }
    if (!['opened', 'closed', 'reopened', 'ready_for_review', 'synchronize'].includes(p.action)) return [];
    const r = p.pull_request;
    const kind =
      p.action === 'opened'
        ? 'pr_opened'
        : p.action === 'closed'
          ? r.merged
            ? 'pr_merged'
            : 'pr_closed'
          : 'pr_updated';
    return [
      make(p.repository.id, p.sender ?? null, {
        kind,
        ts: (kind === 'pr_merged' ? r.merged_at : kind === 'pr_closed' ? r.closed_at : null) ?? r.updated_at,
        ref: r.head.ref,
        sha: null,
        prNumber: r.number,
        title: r.title,
        url: r.html_url,
        additions: r.additions ?? null,
        deletions: r.deletions ?? null,
      }),
    ];
  }
  // Installation/repository synchronization is T-402; these events produce no activity.
  return [];
}

export interface AuthorLookup {
  byGithubId(id: number): Promise<string | null>;
  byAlias(raw: string): Promise<string | null>;
}

export async function resolveAuthor(who: GithubActor | null, lookup: AuthorLookup) {
  const raw = who?.email ?? who?.login ?? who?.username ?? who?.name ?? null;
  if (!who) return { actorUserId: null, actorRaw: raw };
  if (who.id !== undefined) {
    const user = await lookup.byGithubId(who.id);
    if (user) return { actorUserId: user, actorRaw: raw };
  }
  const noreply = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/i.exec(who.email ?? '');
  if (noreply && Number.isSafeInteger(Number(noreply[1]))) {
    const user = await lookup.byGithubId(Number(noreply[1]));
    if (user) return { actorUserId: user, actorRaw: raw };
  }
  for (const alias of new Set([who.email, who.login, who.username].filter((s): s is string => !!s))) {
    const user = await lookup.byAlias(alias);
    if (user) return { actorUserId: user, actorRaw: raw };
  }
  return { actorUserId: null, actorRaw: raw };
}
