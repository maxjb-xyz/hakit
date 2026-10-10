import { describe, expect, it } from 'vitest';
import { activityLinkText, aliasKind, referencedTaskNumbers } from './linking';

describe('activity linking helpers', () => {
  it('orders the branch reference before text references and drops duplicates', () => {
    expect(referencedTaskNumbers('feature/hk-4-auth', 'Fix HK-9, see hk-4')).toEqual([4, 9]);
    expect(referencedTaskNumbers('main', 'no refs')).toEqual([]);
    expect(referencedTaskNumbers(null, 'HK-3')).toEqual([3]);
  });
  it('embeds only the stored title and branch name', () => {
    expect(activityLinkText({ title: 'Add login', ref: 'feat/login' })).toBe('Add login\nfeat/login');
    expect(activityLinkText({ title: 'Add login', ref: null })).toBe('Add login');
  });
  it('classifies aliases', () => {
    expect(aliasKind('200+dev@users.noreply.github.com')).toBe('noreply');
    expect(aliasKind('dev@example.com')).toBe('email');
    expect(aliasKind('octocat')).toBe('login');
  });
});
