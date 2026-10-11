import { redact } from './redact';

/**
 * Loggable shape of an unknown error. Drizzle's query error is named plain `Error` and carries the useful part on
 * `cause` (Postgres SQLSTATE code and message), so surface that. Query text is kept but parameters never are: they
 * hold user data.
 */
export function errorSummary(error: unknown): Record<string, string | number | undefined> {
  if (!(error instanceof Error)) return { error: 'unknown' };
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const query = 'query' in error && typeof error.query === 'string' ? error.query : undefined;
  const code = (cause ?? error) as { code?: unknown };
  return {
    error: query ? 'DrizzleQueryError' : error.name,
    message: redact((query ? (cause?.message ?? '') : error.message).slice(0, 300)),
    ...(typeof code.code === 'string' || typeof code.code === 'number' ? { code: code.code } : {}),
    ...(cause && !query ? { cause: cause.name } : {}),
    ...(query ? { query: query.slice(0, 300) } : {}),
  };
}
