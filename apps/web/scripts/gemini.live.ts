import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { geminiProvider } from '../src/worker/services/ai/gemini';
import { llmRouter } from '../src/worker/services/ai/router';
function variable(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((line) => line.trimStart().startsWith(`${name}=`));
    return line
      ?.slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}
function liveProvider() {
  const apiKey = variable('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in apps/web/.dev.vars before this opt-in check.');
  const model = variable('GEMINI_MODEL_PLAN') ?? 'gemini-3.8-flash';
  return llmRouter([
    geminiProvider({ apiKey, planModel: model, fastModel: model, timeoutMs: 10_000, log: () => {} }),
  ]);
}
const req = {
  task: 'team.summary' as const,
  tier: 'fast' as const,
  system: 'Return exactly the requested JSON. Set status to ok.',
  input: { check: 'public synthetic smoke test' },
  schema: z.object({ status: z.literal('ok') }),
};
it('live Gemini: generates a tiny validated JSON response with bounded retries', async () => {
  const provider = liveProvider();
  expect(await provider.generateStructured(req)).toEqual({ status: 'ok' });
});
it('live Gemini: streams a tiny validated JSON response with bounded retries', async () => {
  const provider = liveProvider();
  let result = '';
  for await (const chunk of provider.streamStructured!(req)) result += chunk;
  expect(req.schema.parse(JSON.parse(result))).toEqual({ status: 'ok' });
});
