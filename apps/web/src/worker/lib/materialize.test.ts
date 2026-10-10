import { describe, expect, it } from 'vitest';
import { planDocument } from '@hakit/contracts/fixtures';
import { planRows } from './materialize';

const t1 = planDocument.tasks[0]!;
const doc = {
  ...planDocument,
  outline: {
    ...planDocument.outline,
    epics: [
      ...planDocument.outline.epics,
      { key: 'E9', title: 'x', milestoneKey: 'M404', scopeTier: 'could' as const, challengeKeys: [] },
    ],
  },
  tasks: [
    t1,
    { ...t1, key: 'T2', dependsOn: ['T1', 'T1', 'T2', 'NOPE'] },
    { ...t1, key: 'T3', epicKey: 'E9', dependsOn: ['T2'] },
  ],
};

describe('planRows', () => {
  it('numbers tasks from the project counter, maps milestones and target times, drops bad edges', () => {
    const rows = planRows(doc, 5, new Date('2026-10-10T12:00:00Z'));
    expect(rows.tasks.map((t) => [t.key, t.number, t.milestoneKey])).toEqual([
      ['T1', 5, 'M1'],
      ['T2', 6, 'M1'],
      ['T3', 7, null],
    ]);
    expect(rows.milestones[1]).toMatchObject({
      key: 'M2',
      ordinal: 2,
      targetAt: new Date('2026-10-11T06:00:00Z'),
    });
    expect(rows.dependencies).toEqual([
      ['T2', 'T1'],
      ['T3', 'T2'],
    ]);
    expect(rows.tasks[0]!.requiredSkills[0]).toEqual({
      skillSlug: 'cloudflare-workers',
      level: 3,
      weight: 0.6,
    });
    expect(planRows(doc, 1, null).milestones[0]!.targetAt).toBeNull();
  });
});
