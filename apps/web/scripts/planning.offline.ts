/** T-703 report command: no network, API keys, or database. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { CASES } from '../src/worker/services/ai/evals/cases';
import {
  CHECKS,
  formatReport,
  passRates,
  reportArtifact,
  runEvals,
  sameIdeaDifferentTeam,
} from '../src/worker/services/ai/evals/harness';
import { scriptedPlanner, unavailable } from '../src/worker/services/ai/evals/providers';
import { selectCases } from '../src/worker/services/ai/evals/selection';

it('reports and gates offline planning evaluations', async () => {
  const mode = process.env.EVAL_MODE ?? 'scripted';
  if (mode !== 'scripted' && mode !== 'fallback') throw new Error('EVAL_MODE must be scripted or fallback');
  const cases = selectCases(CASES, process.env.EVAL_CASES);
  const results = await runEvals(cases, mode === 'scripted' ? scriptedPlanner : unavailable);
  console.log(
    `OFFLINE ${mode}: synthetic provider, not a live model quality score\n${formatReport(results)}`,
  );
  const path = process.env.EVAL_REPORT_PATH ?? 'test-results/planning-offline.json';
  mkdirSync(dirname(path), { recursive: true });
  const artifact = {
    ...reportArtifact(results, mode, mode === 'scripted' ? 'scripted-fixture' : 'template'),
    sameIdeaDifferentTeam: 'not_run' as 'pass' | 'fail' | 'not_run',
  };
  const left = cases.find((c) => c.id === 'balanced-web×web'),
    right = cases.find((c) => c.id === 'ml-heavy×web');
  if (left && right) {
    const contrast = sameIdeaDifferentTeam(
      results.find((r) => r.id === left.id)!,
      results.find((r) => r.id === right.id)!,
      left,
      right,
    );
    artifact.sameIdeaDifferentTeam = contrast.pass ? 'pass' : 'fail';
  }
  writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`same idea / different team: ${artifact.sameIdeaDifferentTeam}`);
  for (const name of CHECKS) expect(passRates(results)[name], name).toBe(1);
  expect(artifact.sameIdeaDifferentTeam).not.toBe('fail');
});
