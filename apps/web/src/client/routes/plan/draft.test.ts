import { describe, expect, it } from 'vitest';
import { PlanPatch, type PlanDocument } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { applyEdits, editCount, nextTaskKey, noEdits, toPatch } from './draft';

const t1 = planDocument.tasks[0]!;
const doc: PlanDocument = {
  ...planDocument,
  tasks: [
    t1,
    { ...t1, key: 'T2', title: 'Sessions', dependsOn: ['T1'] },
    { ...t1, key: 'T3', priority: 'could' },
  ],
};

describe('plan edits → one PlanPatch', () => {
  it('produces no ops for no or no-op edits', () => {
    expect(toPatch(doc, noEdits()).ops).toEqual([]);
    expect(toPatch(doc, { ...noEdits(), summary: doc.outline.summary, tasks: { T1: t1 } }).ops).toEqual([]);
  });

  it('batches every kind of edit in a stable, schema-valid order', () => {
    const edits = {
      summary: 'New summary',
      scope: { could: ['Voice briefing', 'Dark mode'] },
      tasks: {
        T3: { ...doc.tasks[2]!, priority: 'should' as const },
        T2: { ...doc.tasks[1]!, title: 'Session cookies' },
        T4: { ...t1, key: 'T4', title: 'Docs', dependsOn: ['T1'] },
      },
      removed: ['T1'],
    };
    const patch = PlanPatch.parse(toPatch(doc, edits));
    expect(patch.ops.map((o) => o.op)).toEqual([
      'set_summary',
      'set_scope',
      'remove_task',
      'set_task_priority',
      'upsert_task',
      'upsert_task',
    ]);
    // Removed tasks are dropped from the dependencies of upserted ones.
    const added = patch.ops.find((o) => o.op === 'upsert_task' && o.task.key === 'T4');
    expect(added?.op === 'upsert_task' && added.task.dependsOn).toEqual([]);
    expect(editCount(edits)).toBe(6);
  });

  it('applies edits for the preview the same way the server will', () => {
    const view = applyEdits(doc, {
      ...noEdits(),
      removed: ['T1'],
      tasks: { T4: { ...t1, key: 'T4', dependsOn: [] } },
    });
    expect(view.tasks.map((t) => [t.key, t.dependsOn])).toEqual([
      ['T2', []],
      ['T3', []],
      ['T4', []],
    ]);
  });

  it('picks the next free task key', () => {
    expect(nextTaskKey(doc.tasks)).toBe('T4');
    expect(nextTaskKey([])).toBe('T1');
  });
});
