import { expect, it } from 'vitest';
import { z } from 'zod';
import { llmRouter } from '../src/worker/services/ai/router';
import { liveLlm } from './live-llm';
function liveProvider() {
  return llmRouter([liveLlm({ timeoutMs: 10_000, log: () => {} }).provider]);
}
const req = {
  task: 'team.summary' as const,
  tier: 'fast' as const,
  system: 'Return exactly the requested JSON. Set status to ok.',
  input: { check: 'public synthetic smoke test' },
  schema: z.object({ status: z.literal('ok') }),
};
it('live LLM: generates a tiny validated JSON response with bounded retries', async () => {
  const provider = liveProvider();
  expect(await provider.generateStructured(req)).toEqual({ status: 'ok' });
});
it('live LLM: streams a tiny validated JSON response with bounded retries', async () => {
  const provider = liveProvider();
  let result = '';
  for await (const chunk of provider.streamStructured!(req)) result += chunk;
  expect(req.schema.parse(JSON.parse(result))).toEqual({ status: 'ok' });
});
