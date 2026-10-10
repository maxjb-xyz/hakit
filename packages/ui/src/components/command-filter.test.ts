import { describe, expect, it } from 'vitest';
import { filterCommands, rankCommand } from './command-filter';

const items = [
  { label: 'Go to Mission Control', keywords: 'mc dashboard' },
  { label: 'Go to Tasks', keywords: 'board' },
  { label: 'HK-12 Auth callback', keywords: 'task' },
  { label: 'HK-1 Repo setup', keywords: 'task' },
  { label: 'Tasks for Sam', keywords: '' },
];

describe('rankCommand', () => {
  it('matches everything on an empty query', () => {
    expect(rankCommand(items[0]!, '  ')).toBe(0);
  });
  it('requires every word to appear', () => {
    expect(rankCommand(items[2]!, 'auth zzz')).toBeNull();
    expect(rankCommand(items[2]!, 'auth hk-12')).not.toBeNull();
  });
  it('ranks exact key, prefix, word start, then substring', () => {
    expect(rankCommand(items[3]!, 'hk-1')).toBe(0);
    expect(rankCommand(items[2]!, 'hk-1')).toBe(1);
    expect(rankCommand(items[1]!, 'tasks')).toBe(2);
    expect(rankCommand(items[0]!, 'dash')).toBe(3);
    expect(rankCommand(items[0]!, 'ssion')).toBe(4);
  });
  it('is case and accent insensitive and treats regex characters literally', () => {
    expect(rankCommand({ label: 'Café (beta)' }, 'CAFE')).toBe(0);
    expect(rankCommand({ label: 'Café (beta)' }, '(beta')).toBe(2);
  });
});

describe('filterCommands', () => {
  it('sorts best first and keeps original order on ties', () => {
    expect(filterCommands(items, 'tasks').map((i) => i.label)).toEqual(['Tasks for Sam', 'Go to Tasks']);
    expect(filterCommands(items, 'hk-1').map((i) => i.label)).toEqual([
      'HK-1 Repo setup',
      'HK-12 Auth callback',
    ]);
  });
  it('returns nothing when nothing matches', () => {
    expect(filterCommands(items, 'nope')).toEqual([]);
  });
});
