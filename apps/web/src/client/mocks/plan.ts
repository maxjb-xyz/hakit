/**
 * Fake board for the Code and Agents screens until they are wired to `getBoard` (the Plan screen is real now).
 * `ProjectBoard` ← GET /projects/:pid/board (endpoint `getBoard`, owner PL). Reuses the shared demo fixtures so every
 * screen tells the same story.
 */
import type { ProjectBoard } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { fakeResponse } from './fake';

export const mockBoard: ProjectBoard = fx.board;

/** TODO: replace with api call: `api('getBoard', { params: { pid } })` */
export function fetchBoard(): Promise<ProjectBoard> {
  return fakeResponse(mockBoard);
}
