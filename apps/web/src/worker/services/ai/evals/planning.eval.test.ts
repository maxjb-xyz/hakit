/** T-703 offline planning evals: no network, no database, deterministic providers only. */
import { describe, expect, it } from 'vitest';
import { IdeaCandidates } from '@hakit/contracts';
import { mockLlm } from '../mock';
import { ALLOWED_SKILL_SLUGS, CASES, IDEAS, TEAMS } from './cases';
import {
  CHECKS,
  findPrivateData,
  formatReport,
  passRates,
  reportArtifact,
  runCase,
  runEvals,
  sameIdeaDifferentTeam,
} from './harness';
import { selectCases } from './selection';
import { faultyPlanner, scriptedPlanner, unavailable } from './providers';
import { diagnosticProvider } from './diagnostics';
import { LlmError } from '../structured';

describe('planning evals (offline)', () => {
  it('records typed provider failures without retaining secret-shaped error messages', async () => {
    const wrapped = diagnosticProvider({
      name: 'gemini',
      async generateStructured() {
        throw new LlmError('http', true, 503, 'SECRET-ERROR-BODY');
      },
    });
    await runCase(CASES[0]!, wrapped.provider);
    expect(wrapped.failures.length).toBeGreaterThan(0);
    expect(wrapped.failures[0]).toEqual({ task: 'plan.outline', code: 'http', status: 503 });
    expect(JSON.stringify(wrapped.failures)).not.toContain('SECRET');
  });
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
    expect(sameIdeaDifferentTeam(a, b, web, ml).pass).toBe(true);
    expect(sameIdeaDifferentTeam(a, a, web, web).pass).toBe(false);
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

describe('evaluation report and selection regressions', () => {
  it('rejects empty/unknown selections before running providers', async () => {
    for (const selected of ['', ' , ', 'typo', 'balanced-web×web,typo'])
      expect(() => selectCases(CASES, selected)).toThrow();
    expect(() => selectCases([], undefined)).toThrow();
    expect(() => selectCases([CASES[0]!, CASES[0]!], undefined)).toThrow();
    await expect(runEvals([], scriptedPlanner)).rejects.toThrow();
  });
  it('trims selections, deduplicates them, and supports an explicit full matrix', () => {
    expect(selectCases(CASES, ' balanced-web×web, balanced-web×web ')).toEqual([CASES[0]]);
    expect(selectCases(CASES, 'all')).toHaveLength(11);
    expect(selectCases(CASES)).toHaveLength(11);
  });
  it('records real prompt hashes/call counts without storing prompts or identities', async () => {
    const result = await runCase(CASES[0]!, scriptedPlanner);
    expect(result.requestCount).toBeGreaterThan(1);
    expect(result.promptHashes.every((h) => /^[a-f0-9]{64}$/.test(h))).toBe(true);
    const report = reportArtifact([result], 'scripted', 'scripted-fixture');
    expect(report.caseCount).toBe(1);
    expect(report.mode).toBe('scripted');
    expect(findPrivateData(JSON.stringify(report), CASES[0]!.team)).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('You plan achievable');
    expect(JSON.stringify(report)).not.toContain(CASES[0]!.idea.pitch);
  });
  it('does not echo secret-shaped model text from failed verdicts into reports', async () => {
    const result = await runCase(CASES[0]!, scriptedPlanner);
    result.checks.dag = { pass: false, detail: 'Model emitted gho_123456789012345678901234567890123456' };
    result.feasibility.issues.push({
      code: 'UNKNOWN_DEPENDENCY',
      severity: 'error',
      refs: [],
      message: 'private user@example.test',
    });
    expect(formatReport([result])).not.toContain('gho_');
    expect(JSON.stringify(reportArtifact([result], 'live', 'gemini'))).not.toContain('user@example.test');
    expect(passRates([result]).dag).toBe(0);
  });
  it('reports independent checks failing for negative controls', async () => {
    const good = await runCase(CASES[0]!, scriptedPlanner),
      bad = await runCase(CASES[0]!, faultyPlanner);
    expect(passRates([good, bad]).dag).toBe(0.5);
    expect(formatReport([good, bad])).toContain('50%');
    expect(formatReport([good, bad])).toContain('FAIL');
  });
});
