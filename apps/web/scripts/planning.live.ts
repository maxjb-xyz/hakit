/**
 * T-703 live planning evals against Gemini. Opt-in: `pnpm --filter @hakit/web eval:planning`.
 * Reads GEMINI_API_KEY (and optional GEMINI_MODEL_PLAN) from the environment or apps/web/.dev.vars.
 * Inputs are synthetic fixtures only; no private data or repository content is sent.
 * EVAL_CASES=balanced-web×web,ml-heavy×web narrows the run.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { geminiProvider } from '../src/worker/services/ai/gemini';
import { llmRouter } from '../src/worker/services/ai/router';
import { CASES } from '../src/worker/services/ai/evals/cases';
import { formatReport, passRates, runEvals } from '../src/worker/services/ai/evals/harness';

function variable(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.trimStart().startsWith(`${name}=`));
    return line
      ?.slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}

it('live Gemini: planning evals over golden team × idea cases', async () => {
  const apiKey = variable('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in apps/web/.dev.vars before this opt-in eval.');
  const model = variable('GEMINI_MODEL_PLAN') ?? 'gemini-3.8-flash';
  const llm = llmRouter([
    geminiProvider({ apiKey, planModel: model, fastModel: model, timeoutMs: 60_000, log: () => {} }),
  ]);
  const only = process.env.EVAL_CASES?.split(',');
  const results = await runEvals(only ? CASES.filter((c) => only.includes(c.id)) : CASES, llm);
  console.log(`model ${model}\n${formatReport(results)}`);
  const rates = passRates(results);
  // Hard gates (docs/AI.md §3): the model path must hold, and structure, grounding, deliverables
  // and privacy are 100%. Capacity, schedule, coverage and challenge rates are tracked in the
  // printed report per prompt version rather than gated, because they depend on model judgement.
  expect(results.filter((r) => r.model === 'template').map((r) => r.id)).toEqual([]);
  for (const name of ['schema', 'stream', 'dag', 'skillGrounding', 'deliverables', 'privacy'] as const)
    expect({ name, rate: rates[name] }).toEqual({ name, rate: 1 });
});
