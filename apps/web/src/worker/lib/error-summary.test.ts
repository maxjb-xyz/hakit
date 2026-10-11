import { DrizzleQueryError } from 'drizzle-orm/errors';
import { expect, it } from 'vitest';
import { errorSummary } from './error-summary';

it('surfaces the Postgres cause of a Drizzle query error without its parameters', () => {
  const cause = Object.assign(new Error('column "learning_goals" does not exist'), { code: '42703' });
  const err = new DrizzleQueryError(
    'select "learning_goals" from "member_profiles" where "user_id" = $1',
    ['secret-user-data'],
    cause,
  );
  const summary = errorSummary(err);
  expect(summary).toEqual({
    error: 'DrizzleQueryError',
    message: 'column "learning_goals" does not exist',
    code: '42703',
    query: 'select "learning_goals" from "member_profiles" where "user_id" = $1',
  });
  expect(JSON.stringify(summary)).not.toContain('secret-user-data');
});

it('keeps the name, message and code of other errors, redacted', () => {
  const err = Object.assign(new TypeError('bad header: Bearer abcdefghijklmnop'), { code: 'E1' });
  expect(errorSummary(err)).toEqual({
    error: 'TypeError',
    message: 'bad header: Bearer [redacted]',
    code: 'E1',
  });
  expect(errorSummary('nope')).toEqual({ error: 'unknown' });
});
