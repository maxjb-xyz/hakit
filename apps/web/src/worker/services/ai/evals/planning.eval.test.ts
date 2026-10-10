/** T-703 offline planning evals: no network, no database, deterministic providers only. */
import { describe, expect, it } from 'vitest';
import { IdeaCandidates } from '@hakit/contracts';
import { mockLlm } from '../mock';
import { ALLOWED_SKILL_SLUGS, CASES, IDEAS, TEAMS } from './cases';
import { CHECKS, findPrivateData, formatReport, passRates, runCase, runEvals } from './harness';
import { faultyPlanner, scriptedPlanner, unavailable } from './providers';

describe('planning evals (offline)', () => {
  it('covers every golden team fixture with two ideas', () => {
    expect(Object.keys(TEAMS)).toHaveLength(5);
    for (const team of Object.values(TEAMS))
      expect(CASES.filter((c) => c.team === team && !c.challenges.length)).toHaveLength(2);
    for (const c of CASES)
      for (const slug of [
        ...c.idea.stack.flatMap((s) => s.skillSlugs),
        ...c.team.members.flatMap((m) => m.skills.map((s) => s.slug)),
      ])
        expect(ALLOWED_SKILL_SLUGS).toContain(slug);
  });

  for (const [label, provider, model] of [
    ['scripted model', scriptedPlanner, 'gemini'],
    ['template fallback', unavailable, 'template'],
  ] as const)
    it(`${label}: every check passes on every case`, async () => {
      const results = await runEvals(CASES, provider);
      const rates = passRates(results);
      expect(results.every((r) => r.model === model)).toBe(true);
      for (const name of CHECKS)
        expect({ name, rate: rates[name] }, formatReport(results)).toEqual({ name, rate: 1 });
    });

  it('mock-mode LLM fixtures produce a contract-valid, validated plan', async () => {
    const result = await runCase(CASES[0]!, mockLlm);
    for (const name of ['schema', 'stream', 'dag', 'skillGrounding', 'deliverables', 'privacy'] as const)
      expect(result.checks[name], name).toEqual({ pass: true });
  });

  it('mock-mode ideas are schema-valid and grounded in the taxonomy', async () => {
    const out = await mockLlm.generateStructured({
      task: 'ideas.generate',
      tier: 'plan',
      system: '',
      input: {},
      schema: IdeaCandidates,
    });
    for (const idea of out.ideas)
      for (const slug of idea.stack.flatMap((s) => s.skillSlugs)) expect(ALLOWED_SKILL_SLUGS).toContain(slug);
  });

  it('same idea, different team: coverage diff explains the change', async () => {
    const web = CASES.find((c) => c.id === 'balanced-web×web')!;
    const ml = CASES.find((c) => c.id === 'ml-heavy×web')!;
    const [a, b] = [await runCase(web, scriptedPlanner), await runCase(ml, scriptedPlanner)];
    // The plan for the ML-heavy team carries skill-gap warnings the web team's plan does not,
    // and team fit drops; every new gap is a skill the ML team has below the required level.
    expect(a.skillGaps).toEqual([]);
    expect(b.skillGaps.length).toBeGreaterThan(0);
    expect(b.teamFit).toBeLessThan(a.teamFit);
    const mlLevels = new Map(ml.team.members.flatMap((m) => m.skills.map((s) => [s.slug, s.level] as const)));
    for (const slug of b.skillGaps) {
      const needed = Math.max(
        ...b.plan.tasks.flatMap((t) => t.requiredSkills.filter((s) => s.slug === slug).map((s) => s.level)),
      );
      expect(mlLevels.get(slug) ?? 0).toBeLessThan(needed);
    }
  });

  it('negative control: the scorer catches cycles and ungrounded skills', async () => {
    const result = await runCase(CASES[0]!, faultyPlanner);
    expect(result.checks.dag.pass).toBe(false);
    // Unknown skills are dropped by the validator, but it must still surface the warning.
    expect(result.checks.skillGrounding.pass).toBe(false);
  });

  it('privacy scan flags member identities and secret-shaped tokens', () => {
    const team = TEAMS.balancedWeb!;
    expect(findPrivateData('Assigned to Avery Quill', team)).toBe('Avery Quill');
    expect(findPrivateData('key AIzaSyA1234567890abcdefghijklmnop', team)).toBeDefined();
    expect(findPrivateData(JSON.stringify(IDEAS), team)).toBeUndefined();
  });
});
