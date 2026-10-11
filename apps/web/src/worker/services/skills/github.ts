/** Bounded public-only GitHub fetcher. No source files are sent to AI. */
import { z } from 'zod';
import type { RepoFacts } from '@hakit/engine';
const blob = z.object({ text: z.string().nullable(), byteSize: z.number() }).nullable();
const repoSchema = z.object({
  nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  url: z.url(),
  isPrivate: z.boolean(),
  isArchived: z.boolean(),
  isFork: z.boolean(),
  pushedAt: z.iso.datetime().nullable(),
  diskUsage: z.number().nonnegative(),
  languages: z.object({
    totalSize: z.number().nonnegative().optional(),
    edges: z.array(z.object({ size: z.number().nonnegative(), node: z.object({ name: z.string() }) })),
  }),
  repositoryTopics: z.object({ nodes: z.array(z.object({ topic: z.object({ name: z.string() }) })) }),
});
const manifests = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'pubspec.yaml',
  'CMakeLists.txt',
  'platformio.ini',
  'Dockerfile',
  'wrangler.toml',
  'wrangler.jsonc',
  'wrangler.json',
];
/** GitHub's GraphQL tree/blob queries routinely take several seconds; the queue consumer has minutes. */
const REQUEST_TIMEOUT_MS = 25_000;
/** Repos per manifest query, and manifest queries in flight. Bigger batches make GitHub time out. */
const MANIFEST_BATCH = 3;
const MANIFEST_CONCURRENCY = 2;
async function request(path: string, token: string | null, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hakit',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'manual',
  });
  if (!response.ok) throw new Error('GitHub skill import unavailable; retry or sign in again');
  return response.json();
}
export async function fetchPublicRepos(login: string, token: string | null): Promise<RepoFacts[]> {
  z.string()
    .regex(/^[\w-]+$/)
    .parse(login);
  if (!token) return publicFallback(login);
  const metadata =
    'nameWithOwner url isPrivate isArchived isFork pushedAt diskUsage languages(first:20){totalSize edges{size node{name}}} repositoryTopics(first:20){nodes{topic{name}}}';
  const response = z
    .object({
      data: z.object({
        user: z
          .object({ id: z.string().optional(), repositories: z.object({ nodes: z.array(repoSchema) }) })
          .nullable(),
      }),
    })
    .parse(
      await request('/graphql', token, {
        method: 'POST',
        body: JSON.stringify({
          query: `query($login:String!){user(login:$login){id repositories(first:100,privacy:PUBLIC,ownerAffiliations:OWNER,orderBy:{field:PUSHED_AT,direction:DESC}){nodes{${metadata}}}}}`,
          variables: { login },
        }),
      }),
    );
  const candidates = (response.data.user?.repositories.nodes ?? []).filter(
    (r) => !r.isPrivate && !r.isArchived && r.pushedAt,
  );
  const userNodeId = response.data.user?.id;
  const contributed = new Set<string>();
  const forks = candidates.filter((r) => r.isFork);
  if (forks.length && userNodeId) {
    const selections = forks
      .map((r, i) => {
        const [owner, name] = r.nameWithOwner.split('/');
        return `f${i}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){isPrivate defaultBranchRef{target{... on Commit{history(first:1,author:{id:${JSON.stringify(userNodeId)}}){totalCount}}}}}`;
      })
      .join(' ');
    const result = z
      .object({
        data: z.record(
          z.string(),
          z
            .object({
              isPrivate: z.boolean(),
              defaultBranchRef: z
                .object({
                  target: z.object({ history: z.object({ totalCount: z.number().int().nonnegative() }) }),
                })
                .nullable(),
            })
            .nullable(),
        ),
      })
      .parse(
        await request('/graphql', token, {
          method: 'POST',
          body: JSON.stringify({ query: `query{${selections}}` }),
        }),
      );
    forks.forEach((r, i) => {
      const row = result.data[`f${i}`];
      if (row && !row.isPrivate && (row.defaultBranchRef?.target.history.totalCount ?? 0) > 0)
        contributed.add(r.nameWithOwner);
    });
  }
  const repos = candidates.filter((r) => !r.isFork || contributed.has(r.nameWithOwner)).slice(0, 40);
  // Discover manifest paths from trees before fetching blobs, a few small batches at a time.
  const facts: RepoFacts[] = [];
  const treeEntry = z.object({ name: z.string(), type: z.string(), object: z.unknown().optional() });
  const treeSchema = z.object({ entries: z.array(treeEntry).nullable() });
  const walk = (raw: unknown, prefix = '', depth = 0): string[] => {
    if (!raw || depth > 3) return [];
    return (treeSchema.parse(raw).entries ?? []).flatMap((e) => {
      const path = prefix + e.name;
      return e.type === 'tree' ? walk(e.object, path + '/', depth + 1) : [path];
    });
  };
  const treeFields =
    'entries{name type object{... on Tree{entries{name type object{... on Tree{entries{name type object{... on Tree{entries{name type}}}}}}}}}}';
  const metadataOnly = (r: (typeof repos)[number]): RepoFacts => ({
    fullName: r.nameWithOwner,
    url: r.url,
    pushedAt: new Date(r.pushedAt!),
    sizeKb: r.diskUsage,
    isFork: r.isFork,
    languages: Object.fromEntries(r.languages.edges.map((e) => [e.node.name, e.size])),
    languageBytesTotal: r.languages.totalSize,
    topics: r.repositoryTopics.nodes.map((t) => t.topic.name),
    files: {},
    readmeExcerpt: null,
  });
  const groups = Array.from({ length: Math.ceil(repos.length / MANIFEST_BATCH) }, (_, i) =>
    repos.slice(i * MANIFEST_BATCH, (i + 1) * MANIFEST_BATCH),
  );
  for (let offset = 0; offset < groups.length; offset += MANIFEST_CONCURRENCY) {
    const results = await Promise.all(
      groups.slice(offset, offset + MANIFEST_CONCURRENCY).map(async (chunk) => {
        try {
          const select = (r: (typeof repos)[number], i: number, fields: string) => {
            const [owner, name] = r.nameWithOwner.split('/');
            return `r${i}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){isPrivate ${fields}}`;
          };
          const query = async (selections: string) =>
            z.object({ data: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()) }).parse(
              await request('/graphql', token, {
                method: 'POST',
                body: JSON.stringify({ query: `query{${selections}}` }),
              }),
            ).data;
          const trees = await query(
            chunk
              .map((r, i) => select(r, i, `tree:object(expression:"HEAD:"){... on Tree{${treeFields}}}`))
              .join(' '),
          );
          const paths = chunk.map((_, i) => {
            const raw = trees[`r${i}`];
            if (!raw || raw.isPrivate !== false) return [];
            return walk(raw.tree)
              .filter(
                (path) =>
                  manifests.includes(path.split('/').at(-1)!) ||
                  path.endsWith('.csproj') ||
                  /^\.github\/workflows\/.*\.ya?ml$/.test(path) ||
                  /(^|\/)readme(?:\.md|\.rst|\.txt)?$/i.test(path),
              )
              .sort()
              .slice(0, 24);
          });
          const blobs = await query(
            chunk
              .map((r, i) =>
                select(
                  r,
                  i,
                  paths[i]!.map(
                    (path, j) =>
                      `f${j}:object(expression:${JSON.stringify('HEAD:' + path)}){... on Blob{text byteSize}}`,
                  ).join(' '),
                ),
              )
              .join(' '),
          );
          return chunk.flatMap((r, i) => {
            const raw = blobs[`r${i}`];
            if (!raw || raw.isPrivate !== false) return [];
            const files: Record<string, string | null> = {};
            let readmeExcerpt: string | null = null;
            paths[i]!.forEach((path, j) => {
              const b = blob.parse(raw[`f${j}`]);
              if (!b || b.text === null || b.byteSize > 64000) return;
              if (/(^|\/)readme(?:\.md|\.rst|\.txt)?$/i.test(path)) readmeExcerpt ??= b.text.slice(0, 2048);
              else files[path] = b.text;
            });
            return [{ ...metadataOnly(r), files, readmeExcerpt }];
          });
        } catch {
          // A slow or failed manifest batch costs only its dependency evidence; languages and topics still count.
          return chunk.map(metadataOnly);
        }
      }),
    );
    facts.push(...results.flat());
  }
  return facts;
}
async function publicFallback(login: string): Promise<RepoFacts[]> {
  const repos = z
    .array(
      z.object({
        full_name: z.string(),
        html_url: z.url(),
        private: z.boolean(),
        archived: z.boolean(),
        fork: z.boolean(),
        pushed_at: z.iso.datetime().nullable(),
        size: z.number(),
        language: z.string().nullable(),
        topics: z.array(z.string()).default([]),
      }),
    )
    .parse(
      await request(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`, null),
    );
  // Rate-limited unauthenticated mode deliberately uses metadata only; don't claim manifests were read.
  return repos
    .filter((r) => !r.private && !r.archived && !r.fork && r.pushed_at)
    .slice(0, 40)
    .map((r) => ({
      fullName: r.full_name,
      url: r.html_url,
      pushedAt: new Date(r.pushed_at!),
      sizeKb: r.size,
      isFork: false,
      languages: {},
      primaryLanguage: r.language,
      topics: r.topics,
      files: {},
      readmeExcerpt: null,
    }));
}
