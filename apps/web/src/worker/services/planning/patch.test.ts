import { describe, expect, it } from 'vitest';
import { planDocument } from '@hakit/contracts/fixtures';
import { HttpError } from '../../lib/errors';
import { applyPlanPatch } from './patch';

const t1 = planDocument.tasks[0]!;
const doc = {
  ...planDocument,
  tasks: [t1, { ...t1, key: 'T2', dependsOn: ['T1'] }, { ...t1, key: 'T3', dependsOn: ['T1', 'T2'] }],
};

describe('applyPlanPatch (T-307)', () => {
  it('applies ops in order without mutating the source document', () => {
    const before = structuredClone(doc);
    const out = applyPlanPatch(doc, {
      ops: [
        { op: 'set_summary', value: 'Sharper summary' },
        { op: 'set_scope', tier: 'could', value: ['Dark mode'] },
        { op: 'upsert_task', task: { ...t1, title: 'Renamed' } },
        { op: 'upsert_task', task: { ...t1, key: 'T4', dependsOn: ['T3'], priority: 'could' } },
        { op: 'set_task_priority', key: 'T2', priority: 'should' },
      ],
    });
    expect(doc).toEqual(before);
    expect(out.outline.summary).toBe('Sharper summary');
    expect(out.outline.scope.could).toEqual(['Dark mode']);
    expect(out.outline.scope.must).toEqual(doc.outline.scope.must);
    expect(out.tasks.map((t) => [t.key, t.title, t.priority])).toEqual([
      ['T1', 'Renamed', 'must'],
      ['T2', t1.title, 'should'],
      ['T3', t1.title, 'must'],
      ['T4', t1.title, 'could'],
    ]);
    expect(out.idea).toEqual(doc.idea);
  });

  it('removing a task also drops edges that pointed at it', () => {
    const out = applyPlanPatch(doc, { ops: [{ op: 'remove_task', key: 'T2' }] });
    expect(out.tasks.map((t) => [t.key, t.dependsOn])).toEqual([
      ['T1', []],
      ['T3', ['T1']],
    ]);
  });

  it.each([
    [{ op: 'remove_task' as const, key: 'T9' }, 'Unknown task T9'],
    [{ op: 'set_task_priority' as const, key: 'T9', priority: 'must' as const }, 'Unknown task T9'],
    [{ op: 'upsert_task' as const, task: { ...t1, epicKey: 'E9' } }, 'unknown epic E9'],
    [{ op: 'upsert_task' as const, task: { ...t1, dependsOn: ['T1'] } }, 'cannot depend on itself'],
  ])('rejects stale or invalid references: %o', (op, message) => {
    let error: unknown;
    try {
      applyPlanPatch(doc, { ops: [op] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_patch' });
    expect((error as Error).message).toContain(message);
  });
});
