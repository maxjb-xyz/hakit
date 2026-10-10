import { z } from 'zod';
import { GithubId, RepoSummary, Timestamp } from '@hakit/contracts';
import { HttpError } from '../../lib/errors';

export const Installation = z.object({
  id: GithubId,
  account: z.object({ login: z.string().min(1), type: z.string().min(1) }),
  repository_selection: z.enum(['all', 'selected']),
  suspended_at: Timestamp.nullable(),
});
export type Installation = z.infer<typeof Installation>;
export const GithubRepo = z.object({
  id: GithubId,
  full_name: z.string().min(1),
  private: z.boolean(),
  html_url: z.url(),
  default_branch: z.string().nullable().optional(),
  pushed_at: Timestamp.nullable().optional(),
  archived: z.boolean().optional(),
});
export type GithubRepo = z.infer<typeof GithubRepo>;

/** Page numbers stay on api.github.com; never follow an upstream URL with the bearer token. */
export function githubDiscovery(fetcher: typeof fetch = fetch) {
  async function pages<T>(token: string, path: string, field: string, item: z.ZodType<T>): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 100; page++) {
      let response: Response;
      try {
        response = await fetcher(`https://api.github.com${path}?per_page=100&page=${page}`, {
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
        throw new HttpError(502, 'github_unavailable', 'GitHub request failed; try again');
      }
      if (response.status === 401)
        throw new HttpError(401, 'github_reauth_required', 'Sign in to GitHub again');
      if (response.status === 403 || response.status === 429)
        throw new HttpError(
          503,
          'github_access_unavailable',
          'GitHub access is restricted or rate limited; try again later',
        );
      if (!response.ok) throw new HttpError(502, 'github_unavailable', 'GitHub request failed; try again');
      const parsed = z
        .object({ total_count: z.number().int().nonnegative(), [field]: z.array(item) })
        .safeParse(await response.json().catch(() => null));
      if (!parsed.success)
        throw new HttpError(502, 'github_invalid_response', 'GitHub returned an invalid response');
      const rows = parsed.data[field] as T[];
      result.push(...rows);
      if (result.length >= (parsed.data.total_count as number) || rows.length === 0) return result;
    }
    throw new HttpError(502, 'github_page_limit', 'GitHub repository listing is too large');
  }
  const listInstallations = (token: string) =>
    pages(token, '/user/installations', 'installations', Installation);
  return {
    listInstallations,
    userHasInstallation: async (token: string, id: number) =>
      (await listInstallations(token)).some((i) => i.id === id && i.suspended_at === null),
    listInstallationRepos: async (token: string) => {
      const repos = new Map<number, z.infer<typeof RepoSummary>>();
      for (const installation of await listInstallations(token)) {
        if (installation.suspended_at !== null) continue;
        for (const repo of await pages(
          token,
          `/user/installations/${installation.id}/repositories`,
          'repositories',
          GithubRepo,
        )) {
          repos.set(
            repo.id,
            RepoSummary.parse({
              id: repo.id,
              fullName: repo.full_name,
              private: repo.private,
              defaultBranch: repo.default_branch ?? 'main',
              htmlUrl: repo.html_url,
              installationId: installation.id,
              pushedAt: repo.pushed_at ?? null,
            }),
          );
        }
      }
      return [...repos.values()];
    },
  };
}
