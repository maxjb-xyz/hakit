import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = () => new HttpError(403, 'forbidden', 'Forbidden');
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in required');
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details);

/** Scaffold stub marker: real implementation lands in the named TASKS.md task. */
export const notImplemented = (taskId: string) =>
  new HttpError(
    501,
    'not_implemented',
    `Not implemented yet (${taskId}). Run with HAKIT_MOCKS=1 for fixtures.`,
  );
