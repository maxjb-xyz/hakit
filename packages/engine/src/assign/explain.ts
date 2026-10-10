/** Deterministic explanation templates (docs/AI.md §C.3). Owner: IN. Task: T-310. */
import type { ReasonCode } from '@hakit/contracts';
import { NotImplementedError } from '../errors';

export interface ExplainContext {
  memberName: (userId: string) => string;
  taskKey: (taskId: string) => string;
  skillName: (slug: string) => string;
}

export function explainAssignment(
  _chosen: { userId: string; reasonCodes: ReasonCode[]; score: number },
  _alternatives: Array<{ userId: string; delta: number; reasonCodes: ReasonCode[] }>,
  _ctx: ExplainContext,
): string {
  throw new NotImplementedError('T-310', 'explainAssignment');
}
