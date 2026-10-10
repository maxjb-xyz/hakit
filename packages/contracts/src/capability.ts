import { z } from 'zod';
import { Id, SkillSlug, Timestamp } from './common';

export const SkillCategory = z.enum([
  'frontend',
  'backend',
  'data',
  'ml_ai',
  'infra_devops',
  'mobile',
  'design_ux',
  'hardware_embedded',
  'game',
  'security',
  'product_pitch',
]);
export type SkillCategory = z.infer<typeof SkillCategory>;

export const Skill = z.object({
  id: Id,
  slug: SkillSlug,
  name: z.string(),
  category: SkillCategory,
  aliases: z.array(z.string()),
});
export type Skill = z.infer<typeof Skill>;

export const SkillLevel = z.number().int().min(1).max(5);
export const Confidence = z.number().min(0).max(1);

export const EvidenceKind = z.enum([
  'repo_language',
  'manifest_dependency',
  'repo_topic',
  'readme_semantic',
  'contribution',
  'self_report',
  'completed_task',
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const Evidence = z.object({
  id: Id,
  skillSlug: SkillSlug,
  kind: EvidenceKind,
  /** Repo full_name, file path, or task key. */
  sourceRef: z.string(),
  url: z.url().nullable(),
  weight: z.number().nonnegative(),
  /** Human-readable, e.g. "react in package.json". */
  summary: z.string(),
  observedAt: Timestamp,
});
export type Evidence = z.infer<typeof Evidence>;

export const SkillSource = z.enum(['inferred', 'confirmed', 'self_added', 'task_history']);
export type SkillSource = z.infer<typeof SkillSource>;

export const MemberSkill = z.object({
  skill: Skill,
  level: SkillLevel,
  confidence: Confidence,
  source: SkillSource,
  confirmedAt: Timestamp.nullable(),
  evidence: z.array(Evidence),
});
export type MemberSkill = z.infer<typeof MemberSkill>;

export const UpsertMemberSkill = z.object({ level: SkillLevel, confirmed: z.boolean().default(true) });
export type UpsertMemberSkill = z.infer<typeof UpsertMemberSkill>;

/** Streamed to the importing member over WS while `skills.import` runs. */
export const SkillImportProgress = z.object({
  stage: z.enum([
    'fetching_repos',
    'reading_manifests',
    'mapping',
    'embedding',
    'aggregating',
    'done',
    'error',
  ]),
  message: z.string(),
  counts: z
    .object({
      repos: z.number().int(),
      languages: z.number().int(),
      dependencies: z.number().int(),
      skills: z.number().int(),
    })
    .partial(),
});
export type SkillImportProgress = z.infer<typeof SkillImportProgress>;

export const CoverageLabel = z.enum(['strong', 'adequate', 'thin', 'gap']);
export type CoverageLabel = z.infer<typeof CoverageLabel>;

/** AI.md §A.3 — computed deterministically by packages/engine. */
export const TeamCapability = z.object({
  workspaceId: Id,
  categories: z.array(
    z.object({
      category: SkillCategory,
      coverage: z.number().min(0).max(5),
      label: CoverageLabel,
      busFactor: z.number().int().nonnegative(),
      topMembers: z.array(z.object({ userId: Id, effectiveLevel: z.number() })),
    }),
  ),
  gaps: z.array(z.object({ category: SkillCategory, note: z.string() })),
  overlaps: z.array(z.object({ skillSlug: SkillSlug, userIds: z.array(Id) })),
  /** Sum of members' available hours per 2-hour bucket across the event. */
  availabilityCurve: z.array(z.object({ bucketStart: Timestamp, hours: z.number().nonnegative() })),
  totalAvailableHours: z.number().nonnegative(),
  /** availableHours × focus factor. */
  totalEffectiveHours: z.number().nonnegative(),
  /** Optional AI prose; always labeled AI-generated in the UI. */
  aiSummary: z.string().nullable(),
});
export type TeamCapability = z.infer<typeof TeamCapability>;
