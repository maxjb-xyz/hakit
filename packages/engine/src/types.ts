/**
 * Engine input types. Built by the worker from DB rows; never fetched by the engine itself.
 * Everything here is plain data so engine functions stay pure and fixture-testable.
 */
import type { AvailabilityWindow, Assignment, SkillCategory, Task, TaskDependency } from '@hakit/contracts';

export interface EngineSkill {
  slug: string;
  category: SkillCategory;
  related: string[];
}

export interface EngineMemberSkill {
  slug: string;
  level: number; // 1..5
  confidence: number; // 0..1
  confirmed: boolean;
}

export interface EngineMember {
  userId: string;
  skills: EngineMemberSkill[];
  learningGoals: string[];
  avoid: string[];
  availability: AvailabilityWindow[];
  availableHours: number;
  /** L2-normalized embeddings (EMBED_DIM). Null when embeddings are unavailable → semantic terms drop to 0. */
  profileEmbedding: number[] | null;
  interestsEmbedding: number[] | null;
}

export interface EngineTask extends Pick<
  Task,
  'id' | 'key' | 'status' | 'priority' | 'estimateHours' | 'requiredSkills' | 'startedAt'
> {
  embedding: number[] | null;
}

export interface ProjectState {
  now: Date;
  deadlineAt: Date;
  /** Hours reserved before the deadline for submission (default 3). */
  submissionBufferHours: number;
  members: EngineMember[];
  tasks: EngineTask[];
  dependencies: TaskDependency[];
  activeAssignments: Pick<Assignment, 'taskId' | 'userId' | 'locked' | 'source'>[];
  /** Last linked activity per task (from activity_hourly + raw tail). */
  lastActivityByTask: Record<string, Date | undefined>;
  lastActivityByMember: Record<string, Date | undefined>;
  taxonomy: Map<string, EngineSkill>;
}

/** Tunables; defaults in ./config.ts. Exposed so evals can sweep them. */
export interface EngineConfig {
  focusFactor: number;
  capacityHeadroom: number;
  integrationBuffer: number;
  weights: {
    relevance: number;
    workload: number;
    preference: number;
    continuity: number;
    availability: number;
  };
  relevanceWeights: { skill: number; semantic: number; interest: number };
  criticalPathMinRelevance: number;
  criticalPathPenalty: number;
  stallMinutes: number;
}
