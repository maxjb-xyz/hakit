import { z } from 'zod';
import { Id, SkillSlug, Timestamp } from './common';

/*
 * AI OUTPUT SCHEMAS (AI.md §B.2)
 * These are sent to Gemini as `responseJsonSchema` via toGeminiSchema() and re-validated with Zod.
 * Keep them Gemini-friendly: plain objects/arrays/enums, no uuid/url formats, no recursion,
 * every field described where intent is not obvious. IDs inside AI output are short local keys
 * ("E1", "T3"), never database UUIDs.
 */

export const ScopeTier = z.enum(['must', 'should', 'could']);
export type ScopeTier = z.infer<typeof ScopeTier>;

export const StackItem = z.object({
  component: z.string().describe('Architecture component, e.g. "Web frontend"'),
  tech: z.string().describe('Concrete technology choice'),
  skillSlugs: z.array(z.string()).describe('Skill slugs from allowedSkillSlugs that this choice requires'),
});

export const IdeaCandidate = z.object({
  title: z.string(),
  pitch: z.string().describe('One or two sentences'),
  problem: z.string(),
  targetUser: z.string(),
  coreFeatures: z.array(z.string()).min(2).max(6),
  challengesAddressed: z.array(
    z.object({ challengeKey: z.string().describe('Challenge key from the input'), how: z.string() }),
  ),
  stack: z.array(StackItem),
  complexity: z.number().int().min(1).max(5),
  risks: z.array(z.string()),
  whyThisTeam: z
    .array(z.string())
    .describe('Reasons grounded in the team capability input, referencing members as M1..Mn'),
});
export type IdeaCandidate = z.infer<typeof IdeaCandidate>;

export const IdeaCandidates = z.object({ ideas: z.array(IdeaCandidate).min(1).max(5) });

export const PlanOutline = z.object({
  summary: z.string(),
  scope: z.object({
    must: z.array(z.string()),
    should: z.array(z.string()),
    could: z.array(z.string()),
    outOfScope: z.array(z.string()),
  }),
  architecture: z.object({
    components: z.array(
      z.object({
        name: z.string(),
        responsibility: z.string(),
        tech: z.string(),
        skillSlugs: z.array(z.string()),
      }),
    ),
    dataFlow: z.array(z.string()).describe('Ordered one-line steps, e.g. "Browser -> API: submit idea"'),
  }),
  milestones: z.array(
    z.object({
      key: z.string().describe('Short key like "M1"'),
      title: z.string(),
      targetHour: z.number().describe('Hours after hacking start'),
    }),
  ),
  epics: z.array(
    z.object({
      key: z.string().describe('Short key like "E1"'),
      title: z.string(),
      milestoneKey: z.string(),
      scopeTier: ScopeTier,
      challengeKeys: z.array(z.string()).describe('Challenges this epic helps satisfy'),
    }),
  ),
  risks: z.array(z.string()),
});
export type PlanOutline = z.infer<typeof PlanOutline>;

export const RequiredSkill = z.object({
  slug: z.string(),
  level: z.number().int().min(1).max(5),
  weight: z.number().min(0).max(1),
});
export type RequiredSkill = z.infer<typeof RequiredSkill>;

export const TaskDraft = z.object({
  key: z.string().describe('Short key unique within the plan, like "T7"'),
  epicKey: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
  estimateHours: z.number().min(0.5).max(8),
  requiredSkills: z.array(RequiredSkill).min(1),
  dependsOn: z.array(z.string()).describe('Task keys this task depends on'),
  priority: ScopeTier,
});
export type TaskDraft = z.infer<typeof TaskDraft>;

export const TaskDrafts = z.object({ tasks: z.array(TaskDraft) });

/* ------------------------- Deterministic validation (AI.md §B.3) ------------------------- */

export const FeasibilityIssueCode = z.enum([
  'UNKNOWN_SKILL',
  'UNKNOWN_DEPENDENCY',
  'DEPENDENCY_CYCLE',
  'TASK_TOO_LARGE',
  'TASK_TOO_SMALL',
  'SKILL_GAP',
  'OVER_CAPACITY',
  'SCHEDULE_OVERRUN',
  'CHALLENGE_UNADDRESSED',
  'MISSING_DELIVERABLE',
]);
export type FeasibilityIssueCode = z.infer<typeof FeasibilityIssueCode>;

export const Feasibility = z.object({
  ok: z.boolean(),
  requiredHours: z.number(),
  availableEffectiveHours: z.number(),
  criticalPathHours: z.number(),
  hoursUntilFinalMilestone: z.number(),
  /** Task keys moved below the cut line by the validator. */
  cutTaskKeys: z.array(z.string()),
  issues: z.array(
    z.object({
      code: FeasibilityIssueCode,
      severity: z.enum(['info', 'warn', 'error']),
      message: z.string(),
      refs: z.array(z.string()).default([]),
    }),
  ),
});
export type Feasibility = z.infer<typeof Feasibility>;

/* --------------------------------- Persisted plan --------------------------------- */

export const PlanDocument = z.object({
  idea: IdeaCandidate,
  outline: PlanOutline,
  tasks: z.array(TaskDraft),
});
export type PlanDocument = z.infer<typeof PlanDocument>;

export const PlanStatus = z.enum(['draft', 'accepted', 'superseded']);

export const Plan = z.object({
  id: Id,
  projectId: Id,
  version: z.number().int().positive(),
  status: PlanStatus,
  payload: PlanDocument,
  feasibility: Feasibility,
  model: z.string(),
  createdAt: Timestamp,
});
export type Plan = z.infer<typeof Plan>;

export const Idea = z.object({
  id: Id,
  projectId: Id,
  source: z.enum(['user', 'ai']),
  /** Deterministic coverage of the idea's stack skills by the team, 0..1. */
  teamFit: z.number().min(0).max(1),
  selected: z.boolean(),
  candidate: IdeaCandidate,
  createdAt: Timestamp,
});
export type Idea = z.infer<typeof Idea>;

/* --------------------------------- Requests --------------------------------- */

export const GenerateIdeas = z.object({
  count: z.number().int().min(1).max(5).default(3),
  guidance: z.string().max(1000).optional(),
});
export type GenerateIdeas = z.infer<typeof GenerateIdeas>;

export const SubmitIdea = z.object({
  title: z.string().min(1),
  pitch: z.string().min(1),
  notes: z.string().optional(),
});
export type SubmitIdea = z.infer<typeof SubmitIdea>;

export const RefineIdea = z.object({ instruction: z.string().min(1).max(1000) });
export type RefineIdea = z.infer<typeof RefineIdea>;

export const GeneratePlan = z.object({ ideaId: Id, guidance: z.string().max(1000).optional() });
export type GeneratePlan = z.infer<typeof GeneratePlan>;

export const PlanPatch = z.object({
  ops: z.array(
    z.discriminatedUnion('op', [
      z.object({ op: z.literal('set_summary'), value: z.string() }),
      z.object({
        op: z.literal('set_scope'),
        tier: z.enum(['must', 'should', 'could', 'outOfScope']),
        value: z.array(z.string()),
      }),
      z.object({ op: z.literal('upsert_task'), task: TaskDraft }),
      z.object({ op: z.literal('remove_task'), key: z.string() }),
      z.object({ op: z.literal('set_task_priority'), key: z.string(), priority: ScopeTier }),
    ]),
  ),
});
export type PlanPatch = z.infer<typeof PlanPatch>;

/** SSE events emitted by POST /projects/:pid/plans:generate. */
export const PlanStreamEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    stage: z.enum(['context', 'outline', 'tasks', 'validate', 'repair', 'save']),
    message: z.string(),
  }),
  z.object({ type: z.literal('outline'), outline: PlanOutline }),
  z.object({ type: z.literal('epic_tasks'), epicKey: z.string(), tasks: z.array(TaskDraft) }),
  z.object({ type: z.literal('validation'), feasibility: Feasibility }),
  z.object({ type: z.literal('done'), planId: Id }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    fallbackAvailable: z.boolean(),
  }),
]);
export type PlanStreamEvent = z.infer<typeof PlanStreamEvent>;

/** SSE events emitted by ideas:generate / ideas:refine. */
export const IdeaStreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), message: z.string() }),
  z.object({ type: z.literal('idea'), idea: Idea }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type IdeaStreamEvent = z.infer<typeof IdeaStreamEvent>;

/** Server-built planning input (AI.md §B.1). Members are pseudonymized M1..Mn. */
export const PlanningContext = z.object({
  team: z.object({
    members: z.array(
      z.object({
        alias: z.string(),
        topSkills: z.array(z.object({ slug: SkillSlug, level: z.number(), confidence: z.number() })),
        learningGoals: z.array(SkillSlug),
        avoid: z.array(SkillSlug),
        availableHours: z.number(),
      }),
    ),
    gaps: z.array(z.string()),
    totalEffectiveHours: z.number(),
  }),
  hackathon: z.object({
    name: z.string(),
    endsAt: Timestamp,
    hoursRemaining: z.number(),
    judgingCriteria: z.array(z.string()),
    tracks: z.array(z.string()),
  }),
  constraints: z.object({
    challenges: z.array(
      z.object({
        key: z.string(),
        sponsor: z.string(),
        title: z.string(),
        requirements: z.array(z.string()),
        requiredTech: z.array(z.string()),
      }),
    ),
    requiredTech: z.array(z.string()),
    excludedTech: z.array(z.string()),
    custom: z.array(z.string()),
  }),
  idea: z.object({ title: z.string(), pitch: z.string(), userNotes: z.string().optional() }).optional(),
  taxonomy: z.object({ allowedSkillSlugs: z.array(SkillSlug) }),
});
export type PlanningContext = z.infer<typeof PlanningContext>;
