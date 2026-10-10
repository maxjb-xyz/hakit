import { afterEach, expect, it, vi } from 'vitest';
import { fetchPublicRepos } from './github';
afterEach(() => vi.unstubAllGlobals());
const repo = (i = 0) => ({
  nameWithOwner: `member/app${i}`,
  url: `https://github.com/member/app${i}`,
  isPrivate: false,
  isArchived: false,
  isFork: false,
  pushedAt: '2026-10-10T00:00:00Z',
  diskUsage: 750,
  languages: { edges: [{ size: 100, node: { name: 'TypeScript' } }] },
  repositoryTopics: { nodes: [{ topic: { name: 'reactjs' } }] },
});
function fakeGithub(count = 1) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(init.body as string) as { query: string };
    if (query.includes('query($login'))
      return Response.json({
        data: { user: { repositories: { nodes: Array.from({ length: count }, (_, i) => repo(i)) } } },
      });
    const data: Record<string, unknown> = {};
    for (const m of query.matchAll(/r(\d+):repository/g)) {
      const index = m[1]!;
      data[`r${index}`] = query.includes('tree:object')
        ? {
            isPrivate: false,
            tree: {
              entries: [
                { name: 'apps', type: 'tree', object: { entries: [{ name: 'package.json', type: 'blob' }] } },
                { name: 'README.md', type: 'blob' },
              ],
            },
          }
        : {
            isPrivate: false,
            f0: { text: 'Public README', byteSize: 13 },
            f1: { text: '{"dependencies":{"react":"1"}}', byteSize: 30 },
          };
    }
    return Response.json({ data });
  });
}
it('fetches metadata, discovers nested manifests, and fetches public blobs', async () => {
  const fetch = fakeGithub();
  vi.stubGlobal('fetch', fetch);
  const facts = await fetchPublicRepos('member', 'private-token');
  expect(facts).toHaveLength(1);
  expect(facts[0]!.files['apps/package.json']).toContain('react');
  expect(facts[0]!.readmeExcerpt).toBe('Public README');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer private-token' });
});
it('caps 40 repos and batches a complete fixture import under 30 seconds', async () => {
  const fetch = fakeGithub(50);
  vi.stubGlobal('fetch', fetch);
  const start = performance.now();
  expect(await fetchPublicRepos('member', 'token')).toHaveLength(40);
  expect(fetch).toHaveBeenCalledTimes(17);
  expect(performance.now() - start).toBeLessThan(30000);
});
it('rejects private, archived and fork repos before reading files', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      data: {
        user: {
          repositories: {
            nodes: [
              { ...repo(), isPrivate: true },
              { ...repo(), isArchived: true },
              { ...repo(), isFork: true },
            ],
          },
        },
      },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await fetchPublicRepos('member', 'token')).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('checks privacy again before fetching blobs', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;
      return Response.json(
        calls === 1
          ? { data: { user: { repositories: { nodes: [repo()] } } } }
          : { data: { r0: { isPrivate: true } } },
      );
    }),
  );
  expect(await fetchPublicRepos('member', 'token')).toEqual([]);
});
it('uses public metadata without a token', async () => {
  const fetch = vi.fn(async () =>
    Response.json([
      {
        full_name: 'member/app',
        html_url: 'https://github.com/member/app',
        private: false,
        archived: false,
        fork: false,
        pushed_at: '2026-10-10T00:00:00Z',
        size: 100,
        language: 'Python',
      },
    ]),
  );
  vi.stubGlobal('fetch', fetch);
  expect((await fetchPublicRepos('member', null))[0]).toMatchObject({
    files: {},
    readmeExcerpt: null,
    languages: { Python: 1 },
  });
  expect(fetch.mock.calls).toHaveLength(1);
});
it('rejects invalid login and malformed responses', async () => {
  const fetch = vi.fn(async () => Response.json({ data: {} }));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchPublicRepos('../private', 'token')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(fetchPublicRepos('member', 'token')).rejects.toThrow();
});
it('does not expose upstream errors or tokens', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('secret-token', { status: 403 })),
  );
  await expect(fetchPublicRepos('member', 'secret-token')).rejects.toThrow('GitHub skill import unavailable');
});

it('admits forks only after verifying member commits on the default branch', async () => {
  const ordinary = fakeGithub();
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const { query } = JSON.parse(init.body as string) as { query: string };
    if (query.includes('query($login'))
      return Response.json({
        data: { user: { id: 'USER_ID', repositories: { nodes: [{ ...repo(), isFork: true }] } } },
      });
    if (query.includes('defaultBranchRef'))
      return Response.json({
        data: { f0: { isPrivate: false, defaultBranchRef: { target: { history: { totalCount: 2 } } } } },
      });
    return ordinary(url, init);
  });
  vi.stubGlobal('fetch', fetch);
  expect((await fetchPublicRepos('member', 'token'))[0]!.isFork).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(4);
});
