import { describe, expect, it } from 'vitest';
import { members } from '@hakit/contracts/fixtures';
import { constraintFit, normTech } from './fit';

describe('constraintFit', () => {
  it('normalizes tech names', () => {
    expect(normTech(' Cloudflare Workers ')).toBe('cloudflare-workers');
  });

  it('marks proficient, gaps, beginners and conflicts deterministically', () => {
    const fit = constraintFit({
      requiredTech: ['TypeScript', 'rocm', 'typescript', 'pytorch', 'postgres'],
      excludedTech: ['postgres', 'firebase'],
      ideaStack: ['firebase', 'typescript'],
      members,
    });
    const by = Object.fromEntries(fit.items.map((i) => [i.tech, i.state]));
    expect(by).toEqual({
      typescript: 'satisfied',
      rocm: 'risky',
      pytorch: 'satisfied',
      postgres: 'conflict',
      firebase: 'conflict',
    });
    expect(fit.items.find((i) => i.tech === 'rocm')!.reason).toBe('No one on the team has it');
    expect(fit.satisfied).toBe(2);
    expect(fit.score).toBeCloseTo(2 / 5);
  });

  it('is a full fit when nothing is required', () => {
    expect(constraintFit({ requiredTech: [], excludedTech: [], ideaStack: [], members }).score).toBe(1);
  });
});
