/**
 * T-703 planning eval harness. Runs the real plan pipeline (services/planning/pipeline.ts) for each
 * golden case against any LlmProvider and scores the output with the engine's deterministic
 * validators. Offline (mock/scripted providers) it runs inside `pnpm test`; live it runs via
 * `pnpm --filter @hakit/web eval:planning` with GEMINI_API_KEY (scripts/planning.live.ts).
 */
import {
  IdeaCandidate,
  PlanDocument,
  PlanStreamEvent,
  PlanningContext,
  type Feasibility,
  type FeasibilityIssueCode,
} from '@hakit/contracts';
import { DEFAULT_CONFIG, ideaTeamFit, topoSort, validatePlan } from '@hakit/engine';
import { createHash } from 'node:crypto';
import { generatePlanPipeline, type PipelineInput } from '../../planning/pipeline';
import type { LlmProvider } from '../types';
import { ALLOWED_SKILL_SLUGS, type EvalCase, type TeamFixture } from './cases';
import { selectCases } from './selection';

export const CHECKS = [
  'schema',
  'stream',
  'dag',
  'taskSizes',
  'skillGrounding',
  'capacity',
  'schedule',
  'deliverables',
  'challenges',
  'coverage',
  'privacy',
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface CaseResult {
  id: string;
  model: string;
  promptHashes: string[];
  requestCount: number;
  checks: Record<CheckName, { pass: boolean; detail?: string }>;
  teamFit: number;
  /** Skill-gap warnings on the idea's stack skills (scored by `coverage`). */
  skillGaps: string[];
  /** Skill-gap warnings on other skills, e.g. injected deliverables (reported, not scored). */
  otherGaps: string[];
  feasibility: Feasibility;
  plan: PlanDocument;
}

/** Same derivation as planning/context.ts, minus related-skill inference (not needed for fixtures). */
export function teamLevels(team: TeamFixture) {
  const levels = new Map<string, number>();
  for (const member of team.members)
    for (const s of member.skills) levels.set(s.slug, Math.max(levels.get(s.slug) ?? 0, s.level));
  return levels;
}

export function pipelineInput(c: EvalCase): PipelineInput {
  const levels = teamLevels(c.team);
  const totalEffectiveHours = c.team.members.reduce(
    (sum, m) => sum + m.availableHours * DEFAULT_CONFIG.focusFactor,
    0,
  );
  const context = PlanningContext.parse({
    team: {
      members: c.team.members.map((m, i) => ({
        alias: `M${i + 1}`,
        topSkills: m.skills.map((s) => ({ slug: s.slug, level: s.level, confidence: 1 })),
        learningGoals: m.learningGoals,
        avoid: m.avoid,
        availableHours: m.availableHours,
      })),
      gaps: [],
      totalEffectiveHours,
    },
    hackathon: {
      name: 'Eval Hackathon',
      endsAt: '2026-10-12T12:00:00.000Z',
      hoursRemaining: c.hoursRemaining,
      judgingCriteria: ['Technical difficulty', 'Design', 'Impact'],
      tracks: [],
    },
    constraints: {
      challenges: c.challenges,
      requiredTech: [],
      excludedTech: [],
      custom: [],
    },
    idea: { title: c.idea.title, pitch: c.idea.pitch },
    taxonomy: { allowedSkillSlugs: ALLOWED_SKILL_SLUGS },
  });
  return {
    idea: IdeaCandidate.parse(c.idea),
    context,
    eventElapsedHours: 0,
    validation: {
      allowedSkillSlugs: new Set(ALLOWED_SKILL_SLUGS),
      teamSize: c.team.members.length,
      totalEffectiveHours,
      hoursUntilDeadline: c.hoursRemaining,
      selectedChallengeKeys: c.challenges.map((ch) => ch.key),
      teamSkillLevels: levels,
    },
  };
}

const SECRET_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email addresses
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bAIza[0-9A-Za-z_-]{20,}/, // Google API keys
  /\bsk-[A-Za-z0-9]{20,}/, // generic provider keys
];

/** Returns the first private string or secret-shaped token found, if any. */
export function findPrivateData(text: string, team: TeamFixture): string | undefined {
  for (const member of team.members)
    for (const value of Object.values(member.private))
      if (text.toLowerCase().includes(value.toLowerCase())) return value;
  for (const pattern of SECRET_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

const has = (f: Feasibility, ...codes: FeasibilityIssueCode[]) =>
  f.issues.filter((i) => codes.includes(i.code) && i.severity !== 'info');

export async function runCase(c: EvalCase, llm: LlmProvider): Promise<CaseResult> {
  const requests: string[] = [];
  const promptHashes = new Set<string>();
  const recording: LlmProvider = {
    name: llm.name,
    generateStructured: (req) => {
      requests.push(JSON.stringify({ system: req.system, input: req.input }));
      promptHashes.add(createHash('sha256').update(req.system).digest('hex'));
      return llm.generateStructured(req);
    },
  };
  const events: PlanStreamEvent[] = [];
  const input = pipelineInput(c);
  const result = await generatePlanPipeline(input, recording, async (e) => {
    events.push(e);
  });
  // Re-score the persisted payload independently of the pipeline's own verdict.
  const checked = validatePlan({
    ...input.validation,
    outline: result.payload.outline,
    tasks: result.payload.tasks,
  });
  // Score the pipeline's verdict on the draft (it sees unknown skills before they are dropped)
  // together with an independent re-validation of the persisted payload.
  const f: Feasibility = {
    ...checked.feasibility,
    issues: [...result.feasibility.issues, ...checked.feasibility.issues],
  };
  const allowed = input.validation.allowedSkillSlugs;
  const ungrounded = [
    ...result.payload.tasks.flatMap((t) => t.requiredSkills.map((s) => s.slug)),
    ...result.payload.outline.architecture.components.flatMap((comp) => comp.skillSlugs),
  ].filter((slug) => !allowed.has(slug));
  // Coverage is judged on the idea's stack skills. Injected deliverables require
  // technical-writing, which most teams lack; that gap is reported separately, not scored.
  const stack = new Set(result.payload.idea.stack.flatMap((s) => s.skillSlugs));
  const allGaps = new Set(
    has(checked.feasibility, 'SKILL_GAP').flatMap((i) => i.refs.filter((r) => allowed.has(r))),
  );
  const skillGaps = [...allGaps].filter((s) => stack.has(s)).sort();
  const otherGaps = [...allGaps].filter((s) => !stack.has(s)).sort();
  const leaked =
    findPrivateData(JSON.stringify(result.payload), c.team) ??
    requests.map((r) => findPrivateData(r, c.team)).find(Boolean);
  const fail = (issues: Feasibility['issues']) =>
    issues.length ? { pass: false, detail: issues.map((i) => i.message).join('; ') } : { pass: true };
  const schema = PlanDocument.safeParse(result.payload);
  const keys = result.payload.tasks.map((t) => t.key);
  const known = new Set(keys);
  const edges = result.payload.tasks.flatMap((t) => t.dependsOn.map((d) => [t.key, d] as [string, string]));
  const dagValid =
    known.size === keys.length && edges.every(([, d]) => known.has(d)) && topoSort(keys, edges).ok;
  const checks: CaseResult['checks'] = {
    schema: schema.success ? { pass: true } : { pass: false, detail: schema.error.message },
    stream: {
      pass:
        events.every((e) => PlanStreamEvent.safeParse(e).success) &&
        events.some((e) => e.type === 'validation'),
    },
    dag: dagValid
      ? fail(has(f, 'UNKNOWN_DEPENDENCY', 'DEPENDENCY_CYCLE'))
      : { pass: false, detail: 'Invalid task references or dependency cycle' },
    taskSizes: fail(has(f, 'TASK_TOO_LARGE', 'TASK_TOO_SMALL')),
    skillGrounding: ungrounded.length
      ? { pass: false, detail: `unknown slugs: ${[...new Set(ungrounded)].join(', ')}` }
      : fail(has(f, 'UNKNOWN_SKILL')),
    capacity: fail(has(f, 'OVER_CAPACITY')),
    schedule: fail(has(f, 'SCHEDULE_OVERRUN')),
    deliverables: fail(has(f, 'MISSING_DELIVERABLE')),
    challenges: fail(has(f, 'CHALLENGE_UNADDRESSED')),
    coverage:
      skillGaps.length > 0 === c.expectSkillGap
        ? { pass: true }
        : {
            pass: false,
            detail: c.expectSkillGap ? 'expected a SKILL_GAP warning' : `unexpected gaps: ${skillGaps}`,
          },
    privacy: leaked ? { pass: false, detail: 'private value or secret-shaped token found' } : { pass: true },
  };
  return {
    id: c.id,
    model: result.model,
    promptHashes: [...promptHashes].sort(),
    requestCount: requests.length,
    checks,
    teamFit: ideaTeamFit(result.payload.idea, input.validation.teamSkillLevels),
    skillGaps,
    otherGaps,
    feasibility: f,
    plan: result.payload,
  };
}

export async function runEvals(cases: EvalCase[], llm: LlmProvider) {
  selectCases(cases);
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c, llm));
  return results;
}

/** Pass rate per check across cases, for tracking per prompt version (docs/AI.md §3). */
export function passRates(results: CaseResult[]): Record<CheckName, number> {
  return Object.fromEntries(
    CHECKS.map((name) => [
      name,
      results.length ? results.filter((r) => r.checks[name].pass).length / results.length : 0,
    ]),
  ) as Record<CheckName, number>;
}

export function formatReport(results: CaseResult[]): string {
  const rates = passRates(results);
  const lines = [
    `planning evals: ${results.length} cases`,
    ...CHECKS.map((name) => `  ${name.padEnd(15)} ${(rates[name] * 100).toFixed(0).padStart(3)}%`),
  ];
  for (const r of results) {
    const failed = CHECKS.filter((n) => !r.checks[n].pass);
    lines.push(
      `  ${r.id.padEnd(28)} model=${r.model.padEnd(8)} fit=${r.teamFit.toFixed(2)} ` +
        (failed.length ? `FAIL ${failed.join(', ')}` : 'ok'),
    );
  }
  return lines.join('\n');
}

/** Checks an intentional coverage contrast, not that a model rewrites the architecture. */
export function sameIdeaDifferentTeam(a: CaseResult, b: CaseResult, left: EvalCase, right: EvalCase) {
  const sameIdea = JSON.stringify(left.idea) === JSON.stringify(right.idea);
  const preserved =
    JSON.stringify(a.plan.idea) === JSON.stringify(left.idea) &&
    JSON.stringify(b.plan.idea) === JSON.stringify(right.idea);
  const contrasted = a.teamFit > b.teamFit && a.skillGaps.length === 0 && b.skillGaps.length > 0;
  const grounded = b.skillGaps.every((slug) => {
    const required = Math.max(
      0,
      ...b.plan.tasks.flatMap((t) => t.requiredSkills.filter((s) => s.slug === slug).map((s) => s.level)),
    );
    return (teamLevels(right.team).get(slug) ?? 0) < required;
  });
  return { pass: sameIdea && preserved && left.team.id !== right.team.id && contrasted && grounded };
}

/** Safe artifact: excludes prompts, private fixture identities, plan text, and provider error bodies. */
export function reportArtifact(results: CaseResult[], mode: 'scripted' | 'fallback' | 'live', model: string) {
  return {
    version: 1,
    mode,
    model,
    caseCount: results.length,
    passRates: passRates(results),
    cases: results.map((r) => ({
      id: r.id,
      model: r.model,
      promptHashes: r.promptHashes,
      requestCount: r.requestCount,
      checks: Object.fromEntries(CHECKS.map((n) => [n, r.checks[n].pass])),
      teamFit: r.teamFit,
      issueCodes: [...new Set(r.feasibility.issues.map((i) => i.code))].sort(),
    })),
  };
}
