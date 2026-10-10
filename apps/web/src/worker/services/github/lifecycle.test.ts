import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { synchronizeGithub } from './lifecycle';
import { fakeDb, installation } from './t402.test-data';
import { databaseWebhookDependencies, processGithubWebhook } from '../../jobs/github-webhook';
import type { Env } from '../../env';

const at = '2026-10-10T12:00:00.000Z';
const current = { id: installation.id, updatedAt: new Date(0), suspendedAt: null };
const repo = {
  id: 42,
  full_name: 'team/repo',
  private: false,
  html_url: 'https://github.com/team/repo',
  default_branch: 'develop',
  archived: false,
  pushed_at: null,
};
describe('GitHub installation and repository synchronization', () => {
  it('creates installation metadata and handles short repository webhook objects', async () => {
    const s = fakeDb([[]]);
    await synchronizeGithub(
      s.db,
      'installation',
      { action: 'created', installation, repositories: [{ id: 42, full_name: 'team/repo', private: true }] },
      at,
    );
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'github_installations',
      expect.objectContaining({ id: 55501 }),
      expect.anything(),
    );
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'repos',
      expect.objectContaining({
        id: 42,
        installationId: 55501,
        htmlUrl: 'https://github.com/team/repo',
        private: true,
      }),
      expect.anything(),
    );
  });
  it('adds and removes selected repositories using installation-scoped predicates', async () => {
    const s = fakeDb([[current]]);
    await synchronizeGithub(
      s.db,
      'installation_repositories',
      {
        action: 'added',
        installation,
        repository_selection: 'selected',
        repositories_added: [repo],
        repositories_removed: [{ id: 99 }],
      },
      at,
    );
    const removal = s.writes.mock.calls.find((c) => c[0] === 'update')!;
    expect(removal[2]).toMatchObject({ installationId: null });
    expect(new PgDialect().sqlToQuery(removal[3]).params).toEqual([55501, at, 99]);
    expect(s.writes.mock.calls.some((c) => c[1] === 'repos' && c[0] === 'upsert')).toBe(true);
  });
  it('keeps a tombstone and detaches repos after uninstall', async () => {
    const s = fakeDb([[current]]);
    await synchronizeGithub(s.db, 'installation', { action: 'deleted', installation }, at);
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'github_installations',
      expect.objectContaining({ suspendedAt: new Date(at) }),
      expect.anything(),
    );
    expect(s.writes).toHaveBeenCalledWith(
      'update',
      'repos',
      expect.objectContaining({ installationId: null }),
      expect.anything(),
    );
    expect(s.writes.mock.calls.some((c) => c[1] === 'project_repos' || c[1] === 'activity_events')).toBe(
      false,
    );
  });
  it.each([
    ['suspend', new Date(at)],
    ['unsuspend', null],
  ])('handles installation %s', async (action, suspendedAt) => {
    const s = fakeDb([[current]]);
    await synchronizeGithub(s.db, 'installation', { action, installation }, at);
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'github_installations',
      expect.objectContaining({ suspendedAt }),
      expect.anything(),
    );
  });
  it('ignores older deliveries after a newer installation change', async () => {
    const s = fakeDb([[{ ...current, updatedAt: new Date('2026-10-10T13:00:00Z') }]]);
    await synchronizeGithub(s.db, 'installation', { action: 'created', installation }, at);
    expect(s.writes).not.toHaveBeenCalled();
  });
  it.each([
    'created',
    'renamed',
    'edited',
    'archived',
    'unarchived',
    'privatized',
    'publicized',
    'transferred',
  ])('synchronizes repository %s metadata', async (action) => {
    const s = fakeDb([[current]]);
    await synchronizeGithub(
      s.db,
      'repository',
      { action, installation: { id: 55501 }, repository: repo },
      at,
    );
    expect(s.writes).toHaveBeenCalledWith(
      'upsert',
      'repos',
      expect.objectContaining({
        fullName: 'team/repo',
        defaultBranch: 'develop',
        private: false,
      }),
      expect.objectContaining({ setWhere: expect.anything() }),
    );
  });
  it('detaches deleted repositories without erasing past activity', async () => {
    const s = fakeDb([[current]]);
    await synchronizeGithub(
      s.db,
      'repository',
      { action: 'deleted', installation: { id: 55501 }, repository: repo },
      at,
    );
    expect(s.writes).toHaveBeenCalledTimes(1);
    expect(s.writes.mock.calls[0]?.[0]).toBe('update');
  });
  it('retries repository events when installation metadata has not arrived yet', async () => {
    const s = fakeDb([[]]);
    await expect(
      synchronizeGithub(
        s.db,
        'repository',
        { action: 'created', installation: { id: 55501 }, repository: repo },
        at,
      ),
    ).rejects.toThrow('not yet synchronized');
    expect(s.writes).not.toHaveBeenCalled();
  });
  it('rejects malformed lifecycle events before writing', async () => {
    const s = fakeDb([]);
    await expect(synchronizeGithub(s.db, 'installation', {}, at)).rejects.toThrow();
    expect(s.writes).not.toHaveBeenCalled();
  });
  it('dispatches lifecycle jobs through the real queue processor without activity broadcasts', async () => {
    const s = fakeDb([[{ receivedAt: new Date(at), processedAt: null }], []]);
    await processGithubWebhook(
      {
        type: 'github.webhook',
        deliveryId: 'install-1',
        event: 'installation',
        payload: { action: 'created', installation },
      },
      databaseWebhookDependencies(s.db, {} as Env),
    );
    expect(s.trace).toEqual(['commit']);
    expect(s.writes).toHaveBeenCalledWith(
      'update',
      'webhook_deliveries',
      expect.objectContaining({ processedAt: expect.any(Date) }),
      expect.anything(),
    );
    expect(s.writes.mock.calls.some((c) => c[1] === 'activity_events')).toBe(false);
  });
});
