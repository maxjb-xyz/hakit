/** Assignment solver (docs/AI.md §C.1–C.2). Owner: IN. Task: T-309. Must be deterministic for equal input. */
import type { ReasonCode, ScoreBreakdown } from '@hakit/contracts';
import type { EngineConfig, ProjectState } from '../types';
import { DEFAULT_CONFIG } from '../config';
import { NotImplementedError } from '../errors';

export interface SolvedAssignment {
  taskId: string;
  userId: string;
  breakdown: ScoreBreakdown;
  reasonCodes: ReasonCode[];
  alternatives: Array<{ userId: string; score: number; delta: number; reasonCodes: ReasonCode[] }>;
}

export interface SolveResult {
  assignments: SolvedAssignment[];
  unassignedTaskIds: string[];
  warnings: Array<{
    code: 'OVERLOADED_MEMBER' | 'UNMET_SKILL' | 'SINGLE_OWNER_CHAIN' | 'NO_QUALIFIED_MEMBER';
    message: string;
    refs: string[];
  }>;
  load: Array<{ userId: string; assignedHours: number; availableHours: number }>;
}

export interface SolveOptions {
  scope: 'all' | 'unassigned';
  respectLocks: boolean;
  config?: EngineConfig;
}

/** Score one (task, member) pair — exported for explanations of manual overrides. */
export function scorePair(
  _state: ProjectState,
  _taskId: string,
  _userId: string,
  _config: EngineConfig = DEFAULT_CONFIG,
): {
  breakdown: ScoreBreakdown;
  reasonCodes: ReasonCode[];
} {
  throw new NotImplementedError('T-309', 'scorePair');
}

export function solveAssignments(_state: ProjectState, _opts: SolveOptions): SolveResult {
  throw new NotImplementedError('T-309', 'solveAssignments');
}

/** Cosine similarity of two equal-length vectors. Implemented: shared helper. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
