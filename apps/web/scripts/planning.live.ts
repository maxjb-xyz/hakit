/**
 * T-703 live planning evals. Opt-in: `pnpm --filter @hakit/web eval:planning`.
 * Runs against Workers AI or Gemini, whichever is configured (scripts/live-llm.ts).
 * Inputs are synthetic fixtures only; no private data or repository content is sent.
 * EVAL_CASES=balanced-web×web,ml-heavy×web narrows the run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { llmRouter } from '../src/worker/services/ai/router';
import { CASES } from '../src/worker/services/ai/evals/cases';
import {
  formatReport,
  passRates,
  reportArtifact,
  runEvals,
  sameIdeaDifferentTeam,
} from '../src/worker/services/ai/evals/harness';
import { selectCases } from '../src/worker/services/ai/evals/selection';
import { diagnosticProvider } from '../src/worker/services/ai/evals/diagnostics';
import { liveLlm } from './live-llm';

it('live: planning evals over golden team × idea cases', async () => {
  // A minimal contrast by default; running the whole matrix requires explicit EVAL_CASES=all.
  const cases = selectCases(CASES, process.env.EVAL_CASES ?? 'balanced-web×web,ml-heavy×web');
  // Use production tier timeouts (planning 120 s); a shorter eval limit can cause false failures.
  const { provider, model } = liveLlm({ log: () => {} });
  const diagnostics = diagnosticProvider(provider);
  const llm = llmRouter([diagnostics.provider]);
  const results = await runEvals(cases, llm);
  console.log(`model ${model}\n${formatReport(results)}`);
  const artifact = {
    ...reportArtifact(results, 'live', model),
    providerFailures: diagnostics.failures,
    sameIdeaDifferentTeam: 'not_run' as 'pass' | 'fail' | 'not_run',
  };
  const left = cases.find((c) => c.id === 'balanced-web×web'),
    right = cases.find((c) => c.id === 'ml-heavy×web');
  if (left && right)
    artifact.sameIdeaDifferentTeam = sameIdeaDifferentTeam(
      results.find((r) => r.id === left.id)!,
      results.find((r) => r.id === right.id)!,
      left,
      right,
    ).pass
      ? 'pass'
      : 'fail';
  const path = process.env.EVAL_REPORT_PATH ?? 'test-results/planning-live.json';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`same idea / different team: ${artifact.sameIdeaDifferentTeam}`);
  console.log(`provider failures: ${JSON.stringify(artifact.providerFailures)}`);
  const rates = passRates(results);
  // Hard gates (docs/AI.md §3): the model path must hold, and structure, grounding, deliverables
  // and privacy are 100%. Capacity, schedule, coverage and challenge rates are tracked in the
  // printed report per prompt version rather than gated, because they depend on model judgement.
  expect(results.filter((r) => r.model === 'template').map((r) => r.id)).toEqual([]);
  for (const name of [
    'schema',
    'stream',
    'dag',
    'taskSizes',
    'skillGrounding',
    'deliverables',
    'privacy',
  ] as const)
    expect({ name, rate: rates[name] }).toEqual({ name, rate: 1 });
  expect(artifact.sameIdeaDifferentTeam).not.toBe('fail');
});
