/** Team capability profile (docs/AI.md §A.3). Owner: IN. Task: T-206. */
import type { TeamCapability } from '@hakit/contracts';
import type { EngineMember, EngineSkill } from '../types';
import { NotImplementedError } from '../errors';

export function computeTeamCapability(
  _workspaceId: string,
  _members: EngineMember[],
  _taxonomy: Map<string, EngineSkill>,
  _event: { startsAt: Date; endsAt: Date },
): TeamCapability {
  throw new NotImplementedError('T-206', 'computeTeamCapability');
}
