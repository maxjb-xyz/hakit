import { expect, it } from 'vitest';
import { planDocument } from '@hakit/contracts/fixtures';
import { ideaTeamFit } from './idea-fit';
const idea = (slugs: string[]) => ({
  ...planDocument.idea,
  stack: [{ component: 'App', tech: 'Stack', skillSlugs: slugs }],
});
it('averages coverage at level three with confidence already applied', () => {
  expect(
    ideaTeamFit(
      idea(['react', 'python']),
      new Map([
        ['react', 3],
        ['python', 1.5],
      ]),
    ),
  ).toBe(0.75);
});
it('does not let high levels hide an uncovered skill', () => {
  expect(ideaTeamFit(idea(['react', 'python']), new Map([['react', 5]]))).toBe(0.5);
});
it('deduplicates skills across architecture components', () => {
  expect(ideaTeamFit(idea(['react', 'react', 'python']), new Map([['react', 3]]))).toBe(0.5);
});
it('treats an unknown or unspecified stack as zero fit', () => {
  expect(ideaTeamFit(idea([]), new Map([['react', 5]]))).toBe(0);
  expect(ideaTeamFit(idea(['unknown']), new Map())).toBe(0);
});
it('changing the team changes the score without a model call', () => {
  expect(ideaTeamFit(idea(['python']), new Map([['python', 4]]))).toBe(1);
  expect(ideaTeamFit(idea(['python']), new Map([['react', 4]]))).toBe(0);
});
it('rejects corrupt team scores and leaves inputs untouched', () => {
  for (const level of [NaN, Infinity, -1, 6])
    expect(() => ideaTeamFit(idea(['react']), new Map([['react', level]]))).toThrow();
  const candidate = idea(['react']),
    levels = new Map([['react', 1]]);
  const before = JSON.stringify(candidate);
  expect(ideaTeamFit(candidate, levels)).toBe(0.333333);
  expect(JSON.stringify(candidate)).toBe(before);
  expect(levels.get('react')).toBe(1);
});
