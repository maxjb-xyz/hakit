/**
 * Helpers shared by the page mocks in this folder.
 *
 * Every mock file exports `fetchSomething()` functions that return a Promise, exactly like `api(...)` does.
 * That way the pages already handle loading/error states, and connecting the backend later means swapping
 * one `queryFn` line per query (look for "TODO: replace with api call").
 */
import * as fx from '@hakit/contracts/fixtures';

/** The fake data is a story told at 11:00 on day one of Knight Hacks IX. "5m ago" is measured from here. */
export const MOCK_NOW = Date.parse(fx.missionControl.generatedAt);

/** The fixture project id. Real screens use it too until project selection exists (T-302). */
export const MOCK_PROJECT_ID = fx.ids.project;

/** Pretends to be a network call: resolves with `data` after a short delay so you can see loading states. */
export function fakeResponse<T>(data: T, delayMs = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), delayMs));
}
