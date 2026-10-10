import { describe, expect, it } from 'vitest';
import { aggregateEvidence, dependencies, evidenceFromRepo, repositoryWeight, type RepoFacts } from './infer';
const now = new Date('2026-10-10T00:00:00Z');
const repo: RepoFacts = {
  fullName: 'member/app',
  url: 'https://github.com/member/app',
  pushedAt: now,
  sizeKb: 750,
  isFork: false,
  languages: { TypeScript: 900, Python: 100 },
  topics: ['reactjs'],
  files: {
    'package.json': JSON.stringify({
      dependencies: { react: '1', 'react-dom': '1', next: '1' },
      description: 'torch',
    }),
  },
  readmeExcerpt: null,
};
const taxonomy = [{ slug: 'react', name: 'React', aliases: ['reactjs'] }];
describe('public repository evidence', () => {
  it('maps languages, dependencies and aliases with evidence', () => {
    const rows = evidenceFromRepo(repo, now, taxonomy);
    expect(rows.map((e) => e.skillSlug)).toEqual(
      expect.arrayContaining(['typescript', 'python', 'react', 'nextjs']),
    );
    expect(rows.filter((e) => e.skillSlug === 'react' && e.kind === 'manifest_dependency')).toHaveLength(1);
    expect(rows.some((e) => e.skillSlug === 'pytorch')).toBe(false);
    expect(rows.every((e) => e.url === repo.url)).toBe(true);
  });
  it('ignores minor language shares and unknown topics', () => {
    const rows = evidenceFromRepo(
      { ...repo, languages: { TypeScript: 99, Python: 1 }, topics: ['unmapped'], files: {} },
      now,
      taxonomy,
    );
    expect(rows.map((e) => e.skillSlug)).toEqual(['typescript']);
  });
  it('reduces evidence for small and old repositories', () => {
    expect(repositoryWeight({ ...repo, sizeKb: 1 }, now)).toBeLessThan(0.1);
    expect(repositoryWeight({ ...repo, pushedAt: new Date('2020-01-01') }, now)).toBeLessThan(0.1);
    expect(repositoryWeight({ ...repo, pushedAt: new Date('2099-01-01') }, now)).toBe(1);
  });
  it('handles empty and malformed manifests', () => {
    expect(dependencies('package.json', 'no')).toEqual([]);
    expect(dependencies('package.json', 'null')).toEqual([]);
    expect(evidenceFromRepo({ ...repo, sizeKb: 0, languages: {}, files: {} }, now)).toEqual([]);
  });
  it.each([
    ['requirements.txt', 'torch>=2\n# tensorflow', 'pytorch'],
    ['Cargo.toml', '[dependencies]\ntokio = "1"', 'rust-web'],
    ['go.mod', ' github.com/gin-gonic/gin v1.0', 'go-web'],
  ])('maps %s dependency names', (path, text, slug) => {
    expect(
      evidenceFromRepo({ ...repo, languages: {}, topics: [], files: { [path]: text } }, now).some(
        (e) => e.skillSlug === slug,
      ),
    ).toBe(true);
  });
  it('recognizes marker files without contents', () => {
    expect(
      evidenceFromRepo({ ...repo, files: { Dockerfile: null } }, now).some((e) => e.skillSlug === 'docker'),
    ).toBe(true);
  });
  it('deduplicates evidence and counts independent repos', () => {
    const evidence = evidenceFromRepo(repo, now, taxonomy);
    const once = aggregateEvidence(evidence);
    expect(aggregateEvidence([...evidence, ...evidence])).toEqual(once);
    const twice = aggregateEvidence([
      ...evidence,
      ...evidence.map((e) => ({ ...e, sourceRef: e.sourceRef.replace('member/app', 'member/other') })),
    ]);
    expect(twice.find((s) => s.slug === 'react')!.confidence).toBeGreaterThan(
      once.find((s) => s.slug === 'react')!.confidence,
    );
  });
  it('applies semantic-only penalty and minimum confidence', () => {
    const e = { ...evidenceFromRepo(repo, now)[0]!, kind: 'readme_semantic' as const };
    expect(aggregateEvidence([e])).toEqual([]);
    expect(aggregateEvidence([e, { ...e, sourceRef: 'member/other' }])[0]!.confidence).toBeCloseTo(
      (1 - Math.exp(-1)) * 0.6,
    );
  });
  it('discards invalid weights and keeps levels in bounds', () => {
    const e = evidenceFromRepo(repo, now)[0]!;
    expect(
      aggregateEvidence([
        { ...e, weight: NaN },
        { ...e, weight: -1 },
      ]),
    ).toEqual([]);
    expect(aggregateEvidence([{ ...e, weight: 100 }])[0]!.level).toBe(5);
  });
  it('maps 40 fixture repositories in under 30 seconds without mutation', () => {
    const before = JSON.stringify(repo);
    const started = performance.now();
    expect(
      aggregateEvidence(
        Array.from({ length: 40 }, (_, i) =>
          evidenceFromRepo({ ...repo, fullName: `member/app${i}` }, now, taxonomy),
        ).flat(),
      ).length,
    ).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(30000);
    expect(JSON.stringify(repo)).toBe(before);
  });
});

it('parses Maven, Gradle, Python and .NET dependency declarations', () => {
  expect(
    dependencies(
      'pom.xml',
      '<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>',
    ),
  ).toEqual(['org.springframework.boot:spring-boot-starter-web']);
  expect(
    dependencies('build.gradle', `implementation "org.springframework.boot:spring-boot-starter-web:3.0"`),
  ).toEqual(['org.springframework.boot:spring-boot-starter-web']);
  expect(
    dependencies('pyproject.toml', '[project]\ndescription = "torch"\ndependencies = ["numpy>=2", "torch"]'),
  ).toEqual(['numpy', 'torch']);
  expect(
    dependencies(
      'pyproject.toml',
      '[project]\ndependencies = [\n  "fastapi[all]>=0.1",\n  "uvicorn",\n]\n[tool.x]\nother = ["nope"]',
    ),
  ).toEqual(['fastapi', 'uvicorn']);
  expect(dependencies('Cargo.toml', '[package]\nname="tokio"\n[dependencies]\nserde="1"')).toEqual(['serde']);
  expect(
    dependencies('example.csproj', '<PackageReference Include="Newtonsoft.Json" Version="1" />'),
  ).toEqual(['Newtonsoft.Json']);
});

it('recognizes workflow markers and records verified fork contributions', () => {
  const rows = evidenceFromRepo(
    { ...repo, isFork: true, files: { '.github/workflows/check.yaml': null } },
    now,
  );
  expect(rows.some((e) => e.skillSlug === 'github-actions')).toBe(true);
  expect(rows.some((e) => e.kind === 'contribution')).toBe(true);
});

it('maps Shell to the seeded taxonomy and labels fallback language estimates honestly', () => {
  const shell = evidenceFromRepo({ ...repo, languages: { Shell: 100 }, files: {}, topics: [] }, now);
  expect(shell[0]!.skillSlug).toBe('bash-scripting');
  const fallback = evidenceFromRepo(
    { ...repo, languages: {}, primaryLanguage: 'Python', files: {}, topics: [] },
    now,
  );
  expect(fallback[0]).toMatchObject({
    skillSlug: 'python',
    summary: 'Python: GitHub primary language (byte breakdown unavailable)',
  });
  expect(fallback[0]!.weight).toBeLessThan(0.8);
});

it('uses the complete language byte total even when the fetched language list is truncated', () => {
  const rows = evidenceFromRepo(
    { ...repo, languages: { TypeScript: 10 }, languageBytesTotal: 200, files: {}, topics: [] },
    now,
  );
  expect(rows).toEqual([]);
});
