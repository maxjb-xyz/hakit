/** Critical path, velocity, forecast and health (docs/AI.md §C.4). Owner: IN. Task: T-501. */
import type { Health } from '@hakit/contracts';
import type { ProjectState } from '../types';
import { NotImplementedError } from '../errors';

export interface ScheduleResult {
  criticalPathTaskIds: string[];
  remainingCriticalHours: number;
  slackHours: number;
  slackByTask: Record<string, number>;
  /** Estimated — always labeled ≈ in the UI. */
  forecastFinishAt: Date | null;
  velocityHoursPerHour: number | null;
  measuredDone: number;
}

export function computeSchedule(_state: ProjectState): ScheduleResult {
  throw new NotImplementedError('T-501', 'computeSchedule');
}

export function classifyHealth(_state: ProjectState, _schedule: ScheduleResult): Health {
  throw new NotImplementedError('T-501', 'classifyHealth');
}
