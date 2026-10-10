/** Stage bookkeeping for the streamed skill-import checklist (S3). Stages arrive over WS as `skills.import_progress`. */
import type { SkillImportProgress } from '@hakit/contracts';

export type ImportStage = SkillImportProgress['stage'];
export type StepState = 'done' | 'current' | 'pending' | 'failed';

/** The checklist rows, in pipeline order. `done` and `error` are outcomes, not rows. */
export const IMPORT_STEPS: { stage: ImportStage; label: string }[] = [
  { stage: 'fetching_repos', label: 'Reading public repos' },
  { stage: 'reading_manifests', label: 'Reading languages and dependencies' },
  { stage: 'mapping', label: 'Mapping to skills' },
  { stage: 'embedding', label: 'Indexing for matching' },
  { stage: 'aggregating', label: 'Scoring levels from evidence' },
];

/**
 * State of one checklist row given the latest stage and the furthest pipeline stage reached. On `error`
 * the rows before the furthest stage stay done and the furthest one is marked failed.
 */
export function stepState(
  step: ImportStage,
  latest: ImportStage | null,
  furthest: ImportStage | null,
): StepState {
  if (latest === 'done') return 'done';
  const order = IMPORT_STEPS.map((s) => s.stage);
  const at = order.indexOf(step);
  const reached = furthest ? order.indexOf(furthest) : -1;
  if (at < reached) return 'done';
  if (at > reached) return 'pending';
  return latest === 'error' ? 'failed' : 'current';
}

/** "34 repos · 12 languages · 41 dependencies · 18 skills", only the counts the job has reported. */
export function countsLine(counts: SkillImportProgress['counts']): string {
  const parts: string[] = [];
  const add = (n: number | undefined, one: string, many: string) => {
    if (n !== undefined) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(counts.repos, 'repo', 'repos');
  add(counts.languages, 'language', 'languages');
  add(counts.dependencies, 'dependency', 'dependencies');
  add(counts.skills, 'skill', 'skills');
  return parts.join(' · ');
}
