import { describe, expect, it } from 'vitest';
import { Feasibility, type TaskDraft } from '@hakit/contracts';
import { topoSort, validatePlan, type ValidateInput } from './validate';

const task = (key: string, patch: Partial<TaskDraft> = {}): TaskDraft => ({
  key,
  epicKey: 'E1',
  title: key,
  description: '',
  acceptanceCriteria: ['Works'],
  estimateHours: 1,
  requiredSkills: [{ slug: 'typescript', level: 2, weight: 1 }],
  dependsOn: [],
  priority: 'must',
  ...patch,
});
const deliverables = () =>
  ['Repo setup and deploy pipeline', 'Demo script and video', 'Devpost submission', 'README'].map(
    (title, i) => task(`D${i}`, { title, estimateHours: 0.5 }),
  );
const input = (tasks: TaskDraft[] = [], patch: Partial<ValidateInput> = {}): ValidateInput => ({
  outline: {
    summary: '',
    scope: { must: [], should: [], could: [], outOfScope: [] },
    architecture: { components: [], dataFlow: [] },
    milestones: [{ key: 'M1', title: 'MVP', targetHour: 12 }],
    epics: [{ key: 'E1', title: 'MVP', milestoneKey: 'M1', scopeTier: 'must', challengeKeys: [] }],
    risks: [],
  },
  tasks: [...deliverables(), ...tasks],
  allowedSkillSlugs: new Set(['typescript']),
  teamSize: 2,
  totalEffectiveHours: 100,
  hoursUntilDeadline: 30,
  selectedChallengeKeys: [],
  teamSkillLevels: new Map([['typescript', 3]]),
  ...patch,
});
const codes = (data: ValidateInput) => validatePlan(data).feasibility.issues.map((issue) => issue.code);

describe('T-306 plan validation', () => {
  it('accepts a complete feasible plan with contract-valid output', () => {
    const result = validatePlan(input([task('A')]));
    expect(Feasibility.parse(result.feasibility)).toEqual(result.feasibility);
    expect(result.feasibility).toMatchObject({
      ok: true,
      availableEffectiveHours: 85,
      criticalPathHours: 1,
      hoursUntilFinalMilestone: 27,
      issues: [],
      cutTaskKeys: [],
    });
    expect(result.feasibility.requiredHours).toBeCloseTo(3.9);
    expect(result.repairRequests).toEqual([]);
  });
  it('is deterministic and never mutates its inputs', () => {
    const data = input([task('A')]);
    const before = structuredClone(data);
    expect(validatePlan(data)).toEqual(validatePlan(data));
    expect(data).toEqual(before);
  });
  it('allows an empty task list but requests missing deliverables', () => {
    const result = validatePlan(input([], { tasks: [] }));
    expect(result.feasibility.requiredHours).toBe(0);
    expect(result.repairRequests).toHaveLength(4);
  });
  it('rejects malformed task schema', () =>
    expect(() => validatePlan(input([task('A', { acceptanceCriteria: [] })]))).toThrow());
  it.each([0, -1, NaN, Infinity])('rejects invalid estimate %s', (estimateHours) =>
    expect(() => validatePlan(input([task('A', { estimateHours })]))).toThrow(),
  );
  it.each([
    { teamSize: 0 },
    { teamSize: 1.5 },
    { totalEffectiveHours: -1 },
    { hoursUntilDeadline: Infinity },
  ])('rejects invalid context %j', (patch) => expect(() => validatePlan(input([], patch))).toThrow());
  it('drops unknown skills while keeping known requirements', () => {
    const data = input([
      task('A', {
        requiredSkills: [
          { slug: 'unknown', level: 1, weight: 0.5 },
          { slug: 'typescript', level: 2, weight: 0.5 },
        ],
      }),
    ]);
    const result = validatePlan(data);
    expect(result.tasks.at(-1)?.requiredSkills.map((skill) => skill.slug)).toEqual(['typescript']);
    expect(result.feasibility.ok).toBe(true);
    expect(codes(data)).toContain('UNKNOWN_SKILL');
  });
  it('requires repair when dropping skills leaves no valid requirement', () => {
    const result = validatePlan(
      input([task('A', { requiredSkills: [{ slug: 'unknown', level: 1, weight: 1 }] })]),
    );
    expect(result.feasibility.ok).toBe(false);
    expect(result.repairRequests).toHaveLength(1);
  });
  it('requests repair for unknown architecture skills', () => {
    const data = input();
    data.outline.architecture.components.push({
      name: 'Web',
      responsibility: '',
      tech: '',
      skillSlugs: ['unknown'],
    });
    expect(codes(data)).toContain('UNKNOWN_SKILL');
    expect(validatePlan(data).repairRequests).toHaveLength(1);
  });
  it('reports missing dependencies, epics, milestones, and duplicate task keys', () => {
    const data = input([task('A', { dependsOn: ['missing'], epicKey: 'missing' }), task('A')]);
    data.outline.epics[0]!.milestoneKey = 'missing';
    expect(codes(data).filter((code) => code === 'UNKNOWN_DEPENDENCY')).toHaveLength(4);
    expect(validatePlan(data).feasibility.ok).toBe(false);
  });
  it.each([
    [task('A', { dependsOn: ['A'] })],
    [task('A', { dependsOn: ['B'] }), task('B', { dependsOn: ['A'] })],
  ])('reports cycles without crashing or cutting mandatory work', (...tasks) => {
    const result = validatePlan(input(tasks));
    expect(result.feasibility.ok).toBe(false);
    expect(result.feasibility.issues.some((issue) => issue.code === 'DEPENDENCY_CYCLE')).toBe(true);
    expect(result.repairRequests.join(' ')).toContain('A');
  });
  it('computes weighted dependency paths independently of input order', () => {
    const result = validatePlan(
      input([
        task('C', { dependsOn: ['B'], estimateHours: 3 }),
        task('A', { estimateHours: 2 }),
        task('B', { dependsOn: ['A'], estimateHours: 4 }),
      ]),
    );
    expect(result.feasibility.criticalPathHours).toBe(9);
  });
  it('flags split/merge estimates while accepting the exact boundaries', () => {
    expect(codes(input([task('A', { estimateHours: 6.1 }), task('B', { estimateHours: 0.4 })]))).toEqual([
      'TASK_TOO_LARGE',
      'TASK_TOO_SMALL',
    ]);
    expect(codes(input([task('A', { estimateHours: 6 }), task('B', { estimateHours: 0.5 })]))).toEqual([]);
  });
  it('counts gap hours once per task and warns only above 20% of mandatory hours', () => {
    const data = input([
      task('A', {
        requiredSkills: [
          { slug: 'typescript', level: 5, weight: 1 },
          { slug: 'typescript', level: 4, weight: 1 },
        ],
      }),
    ]);
    const issues = validatePlan(data).feasibility.issues.filter((issue) => issue.code === 'SKILL_GAP');
    expect(issues).toHaveLength(2);
    expect(issues[1]?.message).toContain('1 of 3');
    const boundary = input([
      task('A', { requiredSkills: [{ slug: 'typescript', level: 5, weight: 1 }] }),
      task('B', { estimateHours: 2 }),
    ]);
    expect(codes(boundary).filter((code) => code === 'SKILL_GAP')).toHaveLength(1);
  });
  it('treats missing skill levels as zero and optional gaps as task warnings', () => {
    const data = input([task('A', { priority: 'could' })], { teamSkillLevels: new Map() });
    expect(validatePlan(data).feasibility.issues[0]?.message).toContain('team has 0');
    expect(validatePlan(data).feasibility.ok).toBe(true);
  });
  it('cuts should before could, lowest value/hour first, until capacity fits', () => {
    const result = validatePlan(
      input(
        [
          task('S1', { priority: 'should', estimateHours: 2 }),
          task('S2', { priority: 'should' }),
          task('C', { priority: 'could' }),
        ],
        { totalEffectiveHours: 6 },
      ),
    );
    expect(result.feasibility.cutTaskKeys).toEqual(['S1', 'S2']);
    expect(result.feasibility.requiredHours).toBeCloseTo(3.9);
  });
  it('never cuts must tasks or their optional prerequisites', () => {
    const result = validatePlan(
      input([task('A', { dependsOn: ['B'] }), task('B', { priority: 'should' })], { totalEffectiveHours: 1 }),
    );
    expect(result.feasibility.cutTaskKeys).toEqual([]);
    expect(codes(input([], { totalEffectiveHours: 0 }))).toContain('OVER_CAPACITY');
    expect(result.feasibility.ok).toBe(false);
  });
  it('cuts downstream optional work with its prerequisite and leaves no dangling edges', () => {
    const result = validatePlan(
      input(
        [
          task('A', { priority: 'should', estimateHours: 2 }),
          task('B', { priority: 'could', dependsOn: ['A'] }),
        ],
        { totalEffectiveHours: 4 },
      ),
    );
    expect(result.feasibility.cutTaskKeys).toEqual(['A', 'B']);
    const keys = new Set(result.tasks.map((task) => task.key));
    expect(result.tasks.every((task) => task.dependsOn.every((key) => keys.has(key)))).toBe(true);
  });
  it('uses challenge tags to retain higher-value optional work', () => {
    const data = input(
      [task('A', { priority: 'should', epicKey: 'E2' }), task('B', { priority: 'should' })],
      { totalEffectiveHours: 5 },
    );
    data.outline.epics.push({
      key: 'E2',
      title: '',
      milestoneKey: 'M1',
      scopeTier: 'should',
      challengeKeys: ['sponsor'],
    });
    data.selectedChallengeKeys = ['sponsor'];
    expect(validatePlan(data).feasibility.cutTaskKeys).toEqual(['B']);
  });
  it('applies the exact capacity threshold inclusively', () => {
    const data = input([], { totalEffectiveHours: 2.6 / 0.85 });
    expect(codes(data)).not.toContain('OVER_CAPACITY');
  });
  it('caps scheduling by team size and reserves three hours for submission', () => {
    const serial = input([task('A', { estimateHours: 2 }), task('B', { estimateHours: 2 })], {
      teamSize: 1,
      hoursUntilDeadline: 8,
    });
    expect(codes(serial)).toContain('SCHEDULE_OVERRUN');
    expect(codes({ ...serial, teamSize: 2 })).not.toContain('SCHEDULE_OVERRUN');
  });
  it('cuts optional tasks when the schedule alone overruns', () => {
    const result = validatePlan(
      input([task('A', { priority: 'could', estimateHours: 6 })], { hoursUntilDeadline: 5 }),
    );
    expect(result.feasibility.cutTaskKeys).toEqual(['A']);
    expect(result.feasibility.ok).toBe(true);
  });
  it('accepts exactly the submission threshold and handles a passed cutoff', () => {
    expect(codes(input([], { teamSize: 1, hoursUntilDeadline: 5 }))).not.toContain('SCHEDULE_OVERRUN');
    expect(validatePlan(input([], { hoursUntilDeadline: 1 })).feasibility.hoursUntilFinalMilestone).toBe(0);
    expect(codes(input([], { hoursUntilDeadline: 1 }))).toContain('SCHEDULE_OVERRUN');
  });
  it('requires must work addressing each selected challenge', () => {
    const data = input([task('A', { priority: 'should' })], { selectedChallengeKeys: ['sponsor'] });
    data.outline.epics[0]!.challengeKeys = ['sponsor'];
    expect(codes(data)).not.toContain('CHALLENGE_UNADDRESSED');
    data.tasks = [task('A', { priority: 'should' })];
    expect(codes(data)).toContain('CHALLENGE_UNADDRESSED');
  });
  it('reports all missing deliverables without silently inventing tasks', () => {
    const result = validatePlan(input([], { tasks: [task('A')] }));
    expect(result.tasks).toHaveLength(1);
    expect(result.feasibility.issues.filter((issue) => issue.code === 'MISSING_DELIVERABLE')).toHaveLength(4);
  });
});

describe('validator edge cases', () => {
  it('rejects duplicate epic keys instead of silently replacing challenge tags', () => {
    const data = input();
    data.outline.epics.push({ ...data.outline.epics[0]!, challengeKeys: ['other'] });
    const result = validatePlan(data);
    expect(result.feasibility.ok).toBe(false);
    expect(result.repairRequests).toContain('Duplicate epic keys make task references ambiguous');
  });
  it('rejects duplicate milestone keys', () => {
    const data = input();
    data.outline.milestones.push({ ...data.outline.milestones[0]! });
    expect(validatePlan(data).feasibility.ok).toBe(false);
  });
  it('rejects nonfinite or out-of-range team effective levels', () => {
    for (const level of [NaN, Infinity, -1, 6])
      expect(() => validatePlan(input([], { teamSkillLevels: new Map([['typescript', level]]) }))).toThrow(
        'Team effective',
      );
    expect(validatePlan(input([], { teamSkillLevels: new Map() })).feasibility.ok).toBe(true);
  });
  it('accepts known architecture skills', () => {
    const data = input();
    data.outline.architecture.components.push({
      name: 'Web',
      responsibility: '',
      tech: 'TypeScript',
      skillSlugs: ['typescript'],
    });
    expect(codes(data)).toEqual([]);
  });
  it('reports an unknown dependency while keeping numeric schedule output', () => {
    const result = validatePlan(input([task('A', { dependsOn: ['missing'] })]));
    expect(result.feasibility.criticalPathHours).toBe(1);
    expect(result.feasibility.ok).toBe(false);
  });
  it('orders tied could candidates by key and handles already-cut dependants', () => {
    const result = validatePlan(
      input([task('B', { priority: 'could', dependsOn: ['A'] }), task('A', { priority: 'could' })], {
        totalEffectiveHours: 0,
      }),
    );
    expect(result.feasibility.cutTaskKeys).toEqual(['A', 'B']);
    expect(result.feasibility.ok).toBe(false);
  });
  it('reports an optional task referencing an unknown epic', () => {
    const result = validatePlan(
      input([task('A', { priority: 'should', epicKey: 'missing' }), task('B', { priority: 'should' })], {
        totalEffectiveHours: 0,
      }),
    );
    expect(result.feasibility.cutTaskKeys).toEqual(['A', 'B']);
    expect(result.feasibility.ok).toBe(false);
  });
  it('handles multiple prerequisites and ignores external edges in the shared sorter', () => {
    expect(
      topoSort(
        ['a', 'b', 'c'],
        [
          ['c', 'a'],
          ['c', 'b'],
          ['missing', 'a'],
          ['a', 'missing'],
        ],
      ),
    ).toEqual({ ok: true, order: ['a', 'b', 'c'] });
  });
});
