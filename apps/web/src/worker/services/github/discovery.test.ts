import { describe, expect, it, vi } from 'vitest';
import { githubDiscovery } from './discovery';
import { installation } from './t402.test-data';

const rawRepo = {
  id: 42,
  full_name: 'team/repo',
  private: true,
  html_url: 'https://github.com/team/repo',
  default_branch: 'main',
  pushed_at: null,
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe('GitHub repository discovery', () => {
  it('lists only repos accessible to the user and installation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ total_count: 1, installations: [installation] }))
      .mockResolvedValueOnce(response({ total_count: 1, repositories: [rawRepo] }));
    expect(await githubDiscovery(fetcher).listInstallationRepos('test-token')).toEqual([
      {
        id: 42,
        fullName: 'team/repo',
        private: true,
        defaultBranch: 'main',
        htmlUrl: rawRepo.html_url,
        installationId: 55501,
        pushedAt: null,
      },
    ]);
    expect(fetcher.mock.calls[1]?.[0]).toContain('/user/installations/55501/repositories');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      headers: { Authorization: 'Bearer test-token' },
    });
  });
  it('paginates installations and repositories beyond the first page', async () => {
    const many = Array.from({ length: 100 }, (_, id) => ({ ...rawRepo, id }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ total_count: 2, installations: [installation] }))
      .mockResolvedValueOnce(response({ total_count: 2, installations: [{ ...installation, id: 55502 }] }))
      .mockResolvedValueOnce(response({ total_count: 101, repositories: many }))
      .mockResolvedValueOnce(response({ total_count: 101, repositories: [{ ...rawRepo, id: 100 }] }))
      .mockResolvedValueOnce(response({ total_count: 0, repositories: [] }));
    expect(await githubDiscovery(fetcher).listInstallationRepos('token')).toHaveLength(101);
    expect(fetcher.mock.calls[1]?.[0]).toContain('page=2');
    expect(fetcher.mock.calls[3]?.[0]).toContain('page=2');
  });
  it('excludes suspended installations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      response({
        total_count: 1,
        installations: [{ ...installation, suspended_at: '2026-10-10T10:00:00Z' }],
      }),
    );
    expect(await githubDiscovery(fetcher).listInstallationRepos('token')).toEqual([]);
    expect(await githubDiscovery(fetcher).userHasInstallation('token', 55501)).toBe(false);
  });
  it('does not trust an installation ID absent from the user listing', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ total_count: 1, installations: [installation] }));
    expect(await githubDiscovery(fetcher).userHasInstallation('token', 999)).toBe(false);
    expect(await githubDiscovery(fetcher).userHasInstallation('token', 55501)).toBe(true);
  });
  it.each([
    [401, 401],
    [403, 503],
    [429, 503],
    [500, 502],
  ])('maps upstream %i to a safe %i error', async (upstream, status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ message: 'sensitive upstream body' }, upstream));
    await expect(githubDiscovery(fetcher).listInstallations('secret-token')).rejects.toMatchObject({
      status,
    });
  });
  it('rejects malformed GitHub responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ total_count: 1, installations: [{}] }));
    await expect(githubDiscovery(fetcher).listInstallations('token')).rejects.toMatchObject({ status: 502 });
  });
  it('does not expose network errors containing tokens', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-token'));
    await expect(githubDiscovery(fetcher).listInstallations('secret-token')).rejects.toMatchObject({
      message: 'GitHub request failed; try again',
    });
  });
});
