/** Public repository evidence. Pure: callers supply taxonomy and time. */
import type { EvidenceKind, Skill } from '@hakit/contracts';
import { DEP_MAP } from './dep-map';
export interface RepoFacts {
  fullName: string;
  url: string;
  pushedAt: Date;
  sizeKb: number;
  isFork: boolean;
  languages: Record<string, number>;
  /** Total includes languages beyond the fetched first 20. */
  languageBytesTotal?: number;
  /** Primary language is metadata, not a measured byte distribution. */
  primaryLanguage?: string | null;
  topics: string[];
  files: Record<string, string | null>;
  readmeExcerpt: string | null;
}
export interface EvidenceDraft {
  skillSlug: string;
  kind: EvidenceKind;
  sourceRef: string;
  url: string | null;
  weight: number;
  summary: string;
  observedAt: Date;
}
export interface InferredSkill {
  slug: string;
  level: number;
  confidence: number;
  evidence: EvidenceDraft[];
}
const languages: Record<string, string> = {
  TypeScript: 'typescript',
  JavaScript: 'javascript',
  Python: 'python',
  Rust: 'rust',
  Go: 'go',
  Java: 'java',
  Kotlin: 'kotlin',
  Swift: 'swift',
  Dart: 'dart',
  Ruby: 'ruby',
  PHP: 'php',
  'C++': 'cpp',
  C: 'c',
  'C#': 'csharp',
  HTML: 'html-css',
  CSS: 'html-css',
  Shell: 'bash-scripting',
  SQL: 'sql',
};
const normalize = (s: string) => s.toLowerCase().replace(/[-_.\s]/g, '');
export function repositoryWeight(repo: RepoFacts, now: Date): number {
  const months = Math.max(0, now.getTime() - repo.pushedAt.getTime()) / (30.4375 * 86400000);
  return Math.exp(-months / 18) * Math.min(1, Math.log2(1 + Math.max(0, repo.sizeKb) / 50) / 4);
}
/** Extract dependency names, not arbitrary mentions in manifest descriptions. */
export function dependencies(path: string, content: string): string[] {
  if (path.endsWith('package.json')) {
    try {
      const v: unknown = JSON.parse(content);
      if (!v || typeof v !== 'object') return [];
      return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) => {
        const section = (v as Record<string, unknown>)[k];
        return section && typeof section === 'object' && !Array.isArray(section) ? Object.keys(section) : [];
      });
    } catch {
      return [];
    }
  }
  const clean = content
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  const captures = (pattern: RegExp) => [...clean.matchAll(pattern)].map((m) => m[1]!);
  if (/requirements[^/]*\.txt$/.test(path)) return captures(/^\s*([\w.-]+)(?=[<>=!~[;\s]|$)/gm);
  if (path.endsWith('go.mod')) return captures(/^\s*(?:require\s+)?([\w.-]+(?:\/[\w.-]+)+)\s+v/gm);
  if (path.endsWith('pom.xml'))
    return [...clean.matchAll(/<dependency>\s*([\s\S]*?)<\/dependency>/g)].flatMap((m) => {
      const group = m[1]!.match(/<groupId>([^<]+)<\/groupId>/)?.[1];
      const artifact = m[1]!.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
      return group && artifact ? [group.trim() + ':' + artifact.trim()] : [];
    });
  if (/build\.gradle/.test(path)) return captures(/["']([\w.-]+:[\w.-]+)(?=[:"'])/g);
  if (path.endsWith('.csproj')) return captures(/<PackageReference\s+[^>]*Include=["']([^"']+)["']/gi);
  if (path.endsWith('Gemfile')) return captures(/\bgem\s+["']([^"']+)["']/g);
  if (/Cargo\.toml|pyproject\.toml/.test(path)) {
    let section = '';
    let array = false;
    const names: string[] = [];
    for (const line of clean.split('\n')) {
      const heading = line.match(/^\s*\[([^\]]+)\]/);
      if (heading) {
        section = heading[1]!;
        array = false;
      }
      const cargo = path.endsWith('Cargo.toml');
      if (/(?:^|\.)(?:dev-|build-)?dependencies(?:\.|$)/.test(section)) {
        const key = line.match(/^\s*["']?([\w.-]+)["']?\s*=/);
        if (key && key[1] !== 'python') names.push(key[1]!);
        const nested = section.match(/dependencies\.([\w.-]+)$/);
        if (nested) names.push(nested[1]!);
      }
      if (!cargo) {
        if (
          /^\s*(?:dependencies|[\w-]+)\s*=\s*\[/.test(line) &&
          (section === 'project' || section === 'project.optional-dependencies')
        )
          array = true;
        if (array) names.push(...[...line.matchAll(/["']([\w.-]+)(?=[<>=!~[;"'\s])/g)].map((m) => m[1]!));
        if (line.includes(']')) array = false;
      }
    }
    return names;
  }
  if (path.endsWith('pubspec.yaml')) {
    let enabled = false;
    const names: string[] = [];
    for (const line of clean.split('\n')) {
      if (/^\S/.test(line)) enabled = /^(?:dev_)?dependencies:/.test(line);
      if (enabled) {
        const m = line.match(/^ {2}([\w-]+):/);
        if (m) names.push(m[1]!);
      }
    }
    return names;
  }
  if (path.endsWith('platformio.ini')) return captures(/^\s*([\w.-]+(?:\/[\w.-]+)*)(?=\s*@|$)/gm);
  return [];
}
export function evidenceFromRepo(
  repo: RepoFacts,
  now: Date,
  taxonomy: Pick<Skill, 'slug' | 'name' | 'aliases'>[] = [],
): EvidenceDraft[] {
  const result: EvidenceDraft[] = [];
  const factor = repositoryWeight(repo, now);
  const add = (skillSlug: string, kind: EvidenceKind, weight: number, summary: string, path?: string) => {
    if (weight <= 0 || !Number.isFinite(weight)) return;
    result.push({
      skillSlug,
      kind,
      weight: weight * factor,
      sourceRef: path ? `${repo.fullName}:${path}` : repo.fullName,
      url: repo.url,
      summary,
      observedAt: repo.pushedAt,
    });
  };
  const total = repo.languageBytesTotal ?? Object.values(repo.languages).reduce((a, b) => a + b, 0);
  for (const [language, bytes] of Object.entries(repo.languages))
    if (total > 0 && bytes / total >= 0.1 && languages[language])
      add(
        languages[language]!,
        'repo_language',
        (0.8 * bytes) / total,
        `${language}: ${Math.round((100 * bytes) / total)}% of language bytes`,
      );
  if (total === 0 && repo.primaryLanguage && languages[repo.primaryLanguage])
    add(
      languages[repo.primaryLanguage]!,
      'repo_language',
      0.4,
      `${repo.primaryLanguage}: GitHub primary language (byte breakdown unavailable)`,
    );
  for (const [path, content] of Object.entries(repo.files)) {
    const names = new Set(content === null ? [] : dependencies(path, content));
    for (const signal of DEP_MAP) {
      const marker =
        signal.ecosystem === 'file' &&
        (signal.name.startsWith('*.')
          ? path.endsWith(signal.name.slice(1))
          : signal.name.includes('*')
            ? new RegExp(
                '^' +
                  signal.name
                    .split('*')
                    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .join('.*') +
                  '$',
              ).test(path)
            : path === signal.name ||
              path.endsWith('/' + signal.name) ||
              (signal.name === '.github/workflows' && path.startsWith('.github/workflows/')));
      const eco = path.endsWith('package.json')
        ? 'npm'
        : /requirements|pyproject/.test(path)
          ? 'pypi'
          : path.endsWith('go.mod')
            ? 'go'
            : path.endsWith('Cargo.toml')
              ? 'cargo'
              : /pom.xml|build.gradle/.test(path)
                ? 'maven'
                : path.endsWith('Gemfile')
                  ? 'gem'
                  : path.endsWith('pubspec.yaml')
                    ? 'pub'
                    : path.endsWith('.csproj')
                      ? 'nuget'
                      : path.endsWith('platformio.ini')
                        ? 'platformio'
                        : null;
      if (marker || (signal.ecosystem === eco && names.has(signal.name)))
        add(signal.skill, 'manifest_dependency', signal.weight ?? 1, `${signal.name} in ${path}`, path);
    }
  }
  for (const topic of new Set(repo.topics))
    for (const skill of taxonomy)
      if ([skill.slug, skill.name, ...skill.aliases].some((a) => normalize(a) === normalize(topic)))
        add(skill.slug, 'repo_topic', 0.5, `GitHub topic: ${topic}`);
  // The fetcher admits forks only after verifying commits by this member.
  if (repo.isFork) {
    for (const slug of new Set(result.map((e) => e.skillSlug)))
      add(slug, 'contribution', 1.2, 'Verified commits in a public fork');
  }
  // Multiple dependencies for one framework in the same file are one observation.
  return [...new Map(result.map((e) => [`${e.skillSlug}|${e.kind}|${e.sourceRef}`, e])).values()];
}
export function aggregateEvidence(evidence: EvidenceDraft[]): InferredSkill[] {
  const groups = new Map<string, EvidenceDraft[]>();
  for (const e of evidence)
    if (Number.isFinite(e.weight) && e.weight > 0)
      groups.set(e.skillSlug, [...(groups.get(e.skillSlug) ?? []), e]);
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([slug, rows]) => {
      const unique = [...new Map(rows.map((e) => [`${e.kind}|${e.sourceRef}`, e])).values()];
      const count = new Set(unique.map((e) => e.sourceRef.split(':')[0])).size;
      const confidence =
        (1 - Math.exp(-count / 2)) * (unique.every((e) => e.kind === 'readme_semantic') ? 0.6 : 1);
      return confidence < 0.3
        ? []
        : [
            {
              slug,
              level: Math.max(
                1,
                Math.min(
                  5,
                  Math.round(1 + 4 * (1 - Math.exp(-unique.reduce((s, e) => s + e.weight, 0) / 2.5))),
                ),
              ),
              confidence,
              evidence: unique,
            },
          ];
    });
}
