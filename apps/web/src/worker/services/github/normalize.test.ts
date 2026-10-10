import { describe, expect, it, vi } from 'vitest';
import { normalizeGithub, resolveAuthor } from './normalize';

import { receivedAt, repository, sender, pushFixture, prFixture } from './fixtures.test-data';

describe('GitHub normalization', () => {
  it('uses commit author instead of pusher, canonical timestamp, first message line, and branch', () => {
    const [row] = normalizeGithub('push', pushFixture, receivedAt);
    expect(row?.actor).toEqual(pushFixture.commits[0]!.author);
    expect(row?.activity).toMatchObject({
      kind: 'commit',
      title: 'Add café support',
      ref: 'hk-12-feature',
      ts: '2026-10-10T14:00:00.000Z',
      sha: 'abc123',
      additions: null,
      deletions: null,
      taskId: null,
      linkKind: 'none',
    });
  });
  it('deduplicates repeated SHAs within one push', () => {
    expect(
      normalizeGithub(
        'push',
        { ...pushFixture, commits: [...pushFixture.commits, ...pushFixture.commits] },
        receivedAt,
      ),
    ).toHaveLength(1);
  });
  it('includes branch creation from a new branch push', () => {
    expect(
      normalizeGithub('push', { ...pushFixture, created: true }, receivedAt).map((r) => r.activity.kind),
    ).toEqual(['commit', 'branch_created']);
  });
  it('does not generate branch activity for tag pushes', () => {
    expect(
      normalizeGithub('push', { ...pushFixture, ref: 'refs/tags/v1', created: true }, receivedAt).map(
        (r) => r.activity.kind,
      ),
    ).toEqual(['commit']);
  });
  it('does not create commits from deleted pushes', () => {
    expect(normalizeGithub('push', { ...pushFixture, deleted: true }, receivedAt)).toEqual([]);
  });
  it.each([
    ['create', 'branch_created'],
    ['delete', 'branch_deleted'],
  ])('maps %s branch events', (event, kind) => {
    expect(
      normalizeGithub(event, { repository, sender, ref: 'feature', ref_type: 'branch' }, receivedAt)[0]
        ?.activity,
    ).toMatchObject({ kind, ref: 'feature', ts: receivedAt });
  });
  it.each(['create', 'delete'])('ignores %s tag events', (event) => {
    expect(normalizeGithub(event, { repository, ref: 'v1', ref_type: 'tag' }, receivedAt)).toEqual([]);
  });
  it.each([
    ['opened', 'pr_opened'],
    ['closed', 'pr_closed'],
    ['reopened', 'pr_updated'],
    ['ready_for_review', 'pr_updated'],
    ['synchronize', 'pr_updated'],
  ])('maps PR %s', (action, kind) => {
    expect(normalizeGithub('pull_request', { ...prFixture, action }, receivedAt)[0]?.activity).toMatchObject({
      kind,
      prNumber: 12,
      sha: null,
      ref: 'hk-12-feature',
      additions: 10,
      deletions: 2,
    });
  });
  it('distinguishes merged PRs from closed PRs', () => {
    expect(
      normalizeGithub(
        'pull_request',
        {
          ...prFixture,
          action: 'closed',
          pull_request: { ...prFixture.pull_request, merged: true, merged_at: '2026-10-10T11:59:00Z' },
        },
        receivedAt,
      )[0]?.activity,
    ).toMatchObject({ kind: 'pr_merged', ts: '2026-10-10T11:59:00Z' });
  });
  it('maps reviews to the reviewer rather than the PR author', () => {
    expect(
      normalizeGithub(
        'pull_request_review',
        {
          ...prFixture,
          action: 'submitted',
          review: {
            user: { id: 300, login: 'reviewer' },
            state: 'approved',
            submitted_at: receivedAt,
            html_url: 'https://github.com/team/repo/pull/12#review-1',
          },
        },
        receivedAt,
      )[0],
    ).toMatchObject({
      actor: { id: 300 },
      activity: { kind: 'pr_review', title: 'PR #12 review: approved', sha: null },
    });
  });
  it.each(['installation', 'installation_repositories', 'repository', 'unknown'])(
    'has no activity for %s',
    (event) => {
      expect(normalizeGithub(event, {}, receivedAt)).toEqual([]);
    },
  );
  it('ignores unsupported PR/review actions', () => {
    expect(normalizeGithub('pull_request', { ...prFixture, action: 'labeled' }, receivedAt)).toEqual([]);
    expect(normalizeGithub('pull_request_review', { ...prFixture, action: 'dismissed' }, receivedAt)).toEqual(
      [],
    );
  });
  it.each([{}, { ...pushFixture, commits: [{ ...pushFixture.commits[0], timestamp: 'bad' }] }])(
    'rejects malformed pushes',
    (payload) => {
      expect(() => normalizeGithub('push', payload, receivedAt)).toThrow();
    },
  );
});

describe('author attribution', () => {
  const lookup = () => ({
    byGithubId: vi.fn(async (id: number) => (id === 200 ? 'user-200' : null)),
    byAlias: vi.fn(async (raw: string) => (raw === 'known@example.com' ? 'alias-user' : null)),
  });
  it('prefers a numeric GitHub ID over an alias', async () => {
    const deps = lookup();
    expect(await resolveAuthor({ id: 200, email: 'known@example.com' }, deps)).toEqual({
      actorUserId: 'user-200',
      actorRaw: 'known@example.com',
    });
    expect(deps.byAlias).not.toHaveBeenCalled();
  });
  it('extracts numeric ID from noreply email', async () => {
    expect(
      await resolveAuthor({ email: '200+changed-login@users.noreply.github.com' }, lookup()),
    ).toMatchObject({ actorUserId: 'user-200' });
  });
  it('uses saved aliases after an unmatched ID', async () => {
    expect(await resolveAuthor({ id: 999, email: 'known@example.com' }, lookup())).toMatchObject({
      actorUserId: 'alias-user',
    });
  });
  it('keeps unresolved authors visible without guessing from their name', async () => {
    expect(await resolveAuthor({ username: 'unknown', name: 'Someone' }, lookup())).toEqual({
      actorUserId: null,
      actorRaw: 'unknown',
    });
    expect(await resolveAuthor(null, lookup())).toEqual({ actorUserId: null, actorRaw: null });
  });
  it('uses saved login aliases for older noreply addresses', async () => {
    const deps = lookup();
    deps.byAlias.mockResolvedValue('alias-user');
    expect(await resolveAuthor({ email: 'old-login@users.noreply.github.com' }, deps)).toMatchObject({
      actorUserId: 'alias-user',
    });
    expect(deps.byGithubId).not.toHaveBeenCalled();
  });
});
