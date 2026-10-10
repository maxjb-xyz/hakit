import { describe, expect, it } from 'vitest';
import { ReasonCode, ScoreBreakdown } from '@hakit/contracts';
import { DEFAULT_CONFIG } from '../config';
import { scorePair, solveAssignments } from './solve';
import { explainAssignment } from './explain';
import { member, task, state } from '../test-fixtures';
const options = { scope: 'all' as const, respectLocks: true };

describe('assignment constraints', () => {
  it('uses explicit skills and reports weighted score components and alternatives', () => {
    const s = state();
    const result = solveAssignments(s, options);
    expect(result.assignments[0]!.userId).toBe('m1');
    const { breakdown, reasonCodes, alternatives } = result.assignments[0]!;
    expect(ScoreBreakdown.safeParse(breakdown).success).toBe(true);
    expect(reasonCodes.every((r) => ReasonCode.safeParse(r).success)).toBe(true);
    expect(breakdown.total).toBeCloseTo(
      breakdown.relevance +
        breakdown.workload +
        breakdown.preference +
        breakdown.continuity +
        breakdown.availability -
        breakdown.criticalPathPenalty,
    );
    expect(alternatives[0]!.delta).toBeCloseTo(alternatives[0]!.score - breakdown.total);
  });
  it('preserves manual and locked assignments and flags existing overload', () => {
    const s = state([task('t1', 'react', 6)], [member('m1', 'python', 2), member('m2')]);
    s.activeAssignments = [{ taskId: 't1', userId: 'm1', source: 'manual', locked: false }];
    expect(solveAssignments(s, options).assignments[0]!.userId).toBe('m1');
    s.activeAssignments[0]!.source = 'solver';
    s.activeAssignments[0]!.locked = true;
    const solved = solveAssignments(s, options);
    expect(solved.assignments[0]!.reasonCodes).toContain('OVERRIDE_LOCKED');
    expect(solved.warnings.map((w) => w.code)).toContain('OVERLOADED_MEMBER');
  });
  it('keeps existing assignments for unassigned scope', () => {
    const s = state();
    s.activeAssignments = [{ taskId: 't1', userId: 'm2', source: 'solver', locked: false }];
    expect(solveAssignments(s, { ...options, scope: 'unassigned' }).assignments[0]!.userId).toBe('m2');
  });
  it('honors avoid skills and flags the last-resort exception', () => {
    const s = state([task('t1')], [member('m1'), member('m2')]);
    s.members[0]!.avoid = ['react'];
    expect(solveAssignments(s, options).assignments[0]!.userId).toBe('m2');
    s.members[1]!.availableHours = 0;
    expect(solveAssignments(s, options).assignments[0]!.reasonCodes).toContain('AVOIDED_SKILL:react');
    expect(solveAssignments(s, options).warnings.map((w) => w.code)).toContain('UNMET_SKILL');
  });
  it('returns excess tasks unassigned rather than overloading', () => {
    const s = state([task('t1', 'react', 6), task('t2', 'react', 6)], [member('m1', 'react', 10)]);
    const result = solveAssignments(s, options);
    expect(result.load[0]!.assignedHours).toBe(6);
    expect(result.unassignedTaskIds).toHaveLength(1);
  });
  it('uses confidence, related skills, embeddings, learning preferences, continuity, and availability', () => {
    const s = state([task('t1'), task('t2')], [member('m1', 'typescript')]);
    s.taxonomy.set('react', { slug: 'react', category: 'frontend', related: ['typescript'] });
    s.tasks[1]!.priority = 'should';
    s.tasks[1]!.embedding = [1, 0];
    s.members[0]!.learningGoals = ['react'];
    s.members[0]!.profileEmbedding = [1, 0];
    s.members[0]!.interestsEmbedding = [1, 0];
    s.dependencies = [{ taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' }];
    s.activeAssignments = [{ taskId: 't1', userId: 'm1', source: 'manual', locked: true }];
    s.members[0]!.availability = [
      { start: '2026-10-10T00:00:00Z', end: '2026-10-10T01:00:00Z', kind: 'available' },
    ];
    const r = scorePair(s, 't2', 'm1');
    expect(r.reasonCodes).toEqual(
      expect.arrayContaining([
        'RELATED_SKILL:react',
        'LEARNING_GOAL:react',
        'SEMANTIC_MATCH',
        'OWNS_PREDECESSOR:HK-1',
        'UNAVAILABLE_AT_START',
      ]),
    );
    s.members[0]!.skills = [{ slug: 'react', level: 3, confidence: 0, confirmed: false }];
    expect(scorePair(s, 't2', 'm1').breakdown.relevanceParts.skillFit).toBeLessThan(1);
  });
  it('rejects cycles and unknown dependency refs without mutating input', () => {
    const s = state();
    const before = structuredClone(s);
    solveAssignments(s, options);
    expect(s).toEqual(before);
    s.dependencies = [{ taskId: 't1', dependsOnTaskId: 'missing', kind: 'blocks' }];
    expect(() => solveAssignments(s, options)).toThrow('Unknown dependency');
    s.dependencies[0]!.dependsOnTaskId = 't1';
    expect(() => solveAssignments(s, options)).toThrow('cycle');
  });
  it('satisfies capacity, lock, avoid and determinism invariants over generated teams', () => {
    let seed = 305;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let run = 0; run < 25; run++) {
      const s = state(
        Array.from({ length: 12 }, (_, i) =>
          task(`t${i + 1}`, i % 2 ? 'react' : 'python', 0.5 + Math.floor(random() * 6)),
        ),
        Array.from({ length: 3 }, (_, i) =>
          member(`m${i + 1}`, i % 2 ? 'react' : 'python', 8 + random() * 12),
        ),
      );
      s.members[0]!.avoid = ['react'];
      s.activeAssignments = [{ taskId: 't1', userId: 'm2', locked: true, source: 'solver' }];
      const r = solveAssignments(s, options);
      expect(r).toEqual(solveAssignments(s, options));
      expect(r.assignments.find((a) => a.taskId === 't1')!.userId).toBe('m2');
      for (const l of r.load)
        expect(l.assignedHours).toBeLessThanOrEqual(
          l.availableHours * DEFAULT_CONFIG.capacityHeadroom + 1e-9,
        );
      for (const a of r.assignments.filter((a) => a.userId === 'm1'))
        if (s.tasks.find((t) => t.id === a.taskId)!.requiredSkills[0]!.skillSlug === 'react')
          expect(a.reasonCodes).toContain('AVOIDED_SKILL:react');
    }
  });
  it('solves six members and sixty tasks in under 200ms', () => {
    const s = state(
      Array.from({ length: 60 }, (_, i) => task(`t${i + 1}`, i % 2 ? 'react' : 'python', 1)),
      Array.from({ length: 6 }, (_, i) => member(`m${i + 1}`, i % 2 ? 'react' : 'python', 20)),
    );
    s.members.forEach((m) => {
      m.profileEmbedding = Array(1024).fill(0.01);
      m.interestsEmbedding = Array(1024).fill(0.01);
    });
    s.tasks.forEach((t) => {
      t.embedding = Array(1024).fill(0.01);
    });
    for (let i = 1; i < 60; i += 3)
      s.dependencies.push({ taskId: `t${i + 1}`, dependsOnTaskId: `t${i}`, kind: 'blocks' });
    solveAssignments(s, options); // warm module/JIT
    // Best of five: a scheduler stall from parallel test workers can't fail it, a real regression still does.
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const result = solveAssignments(s, options);
      best = Math.min(best, performance.now() - start);
      expect(result.assignments).toHaveLength(60);
    }
    expect(best).toBeLessThan(200);
  });
});
it('renders only supported facts including warnings, locks, and signed alternative deltas', () => {
  const text = explainAssignment(
    {
      userId: 'm1',
      score: 0.55,
      reasonCodes: ['STRONG_SKILL_MATCH:react', 'OVERRIDE_LOCKED', 'AVOIDED_SKILL:python'],
    },
    [{ userId: 'm2', delta: -0.12, reasonCodes: ['NEAR_CAPACITY'] }],
    { memberName: (id) => (id === 'm1' ? 'Maya' : 'Jae'), skillName: (s) => s, taskKey: (s) => s },
  );
  expect(text).toContain('Maya');
  expect(text).toContain('preserved locked');
  expect(text).toContain('avoid python');
  expect(text).toContain('Jae (-0.12');
  expect(text).not.toContain('4/5');
});

it('honors time windows, deadline, and unassigned prerequisites', () => {
  const s = state([task('t1'), task('t2')], [member('m1')]);
  s.members[0]!.availability = [
    { start: '2026-10-10T20:00:00Z', end: '2026-10-10T23:00:00Z', kind: 'available' },
  ];
  s.dependencies = [{ taskId: 't2', dependsOnTaskId: 't1', kind: 'blocks' }];
  const result = solveAssignments(s, { scope: 'all', respectLocks: true });
  expect(result.assignments).toHaveLength(0);
  expect(result.unassignedTaskIds).toEqual(['t1', 't2']);
  s.members[0]!.availability = [
    { start: '2026-10-10T00:00:00Z', end: '2026-10-10T04:00:00Z', kind: 'available' },
  ];
  expect(solveAssignments(s, { scope: 'all', respectLocks: true }).assignments).toHaveLength(2);
});
