import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { llmRouter } from './router';
import type { StructuredRequest } from './types';
import { workersAiProvider, workersAiRest, type WorkersAiRun } from './workers-ai';

const schema = z.object({ title: z.string().min(1) });
const req: StructuredRequest<typeof schema> = {
  task: 'ideas.generate',
  tier: 'plan',
  system: 'Return an idea',
  input: { privateNote: 'do-not-log' },
  schema,
};
const PLAN = '@cf/meta/llama-4-scout-17b-16e-instruct';
const FAST = '@cf/meta/llama-3.1-8b-instruct';
const setup = () => {
  const run = vi.fn<WorkersAiRun>(),
    log = vi.fn();
  const provider = workersAiProvider({ run, planModel: PLAN, fastModel: FAST, log });
  return { run, log, provider };
};
const ok = (response: unknown) => ({ response, usage: { prompt_tokens: 12, completion_tokens: 8 } });

it('sends chat messages with a JSON schema and enough output tokens, and logs only safe metadata', async () => {
  const { run, log, provider } = setup();
  run.mockResolvedValue(ok('{"title":"Idea"}'));
  expect(await provider.generateStructured(req)).toEqual({ title: 'Idea' });
  const [model, inputs, options] = run.mock.calls[0]!;
  expect(model).toBe(PLAN);
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(inputs).toMatchObject({
    response_format: { type: 'json_schema', json_schema: { type: 'object' } },
    max_tokens: 8192,
  });
  const messages = inputs.messages as { role: string; content: string }[];
  expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  expect(messages[1]!.content).toContain('do-not-log');
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'workers_ai',
      model: PLAN,
      inputTokens: 12,
      outputTokens: 8,
      validationPassed: true,
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/do-not-log|Return an idea/);
});

it('uses the fast model and a smaller token budget for the fast tier', async () => {
  const { run, provider } = setup();
  run.mockResolvedValue(ok('{"title":"Idea"}'));
  await provider.generateStructured({ ...req, tier: 'fast', temperature: 0.2 });
  expect(run.mock.calls[0]![0]).toBe(FAST);
  expect(run.mock.calls[0]![1]).toMatchObject({ max_tokens: 2048, temperature: 0.2 });
});

it('accepts an already-parsed object and fenced JSON as the response', async () => {
  const { run, provider } = setup();
  run
    .mockResolvedValueOnce(ok({ title: 'Object' }))
    .mockResolvedValueOnce(ok('```json\n{"title":"Fenced"}\n```'));
  expect(await provider.generateStructured(req)).toEqual({ title: 'Object' });
  expect(await provider.generateStructured(req)).toEqual({ title: 'Fenced' });
});

it('repairs once with validation issues, including when JSON mode cannot be met', async () => {
  const { run, provider } = setup();
  run
    .mockRejectedValueOnce(new Error("5021: JSON Mode couldn't be met"))
    .mockResolvedValueOnce(ok('{"title":"Idea"}'));
  expect(await provider.generateStructured(req)).toEqual({ title: 'Idea' });
  expect(run).toHaveBeenCalledTimes(2);
  const system = (run.mock.calls[1]![1].messages as { content: string }[])[0]!.content;
  expect(system).toContain('Previous response failed JSON/schema validation');
});

it.each([
  ['3040: Capacity temporarily exceeded', 429, true],
  ['3036: daily free allocation exceeded', 429, true],
  ['5007: No such model', 404, false],
  ['5006: Invalid input', 400, false],
  ['something else', 502, true],
])('classifies "%s" without exposing the message', async (message, status, retryable) => {
  const { run, provider } = setup();
  run.mockRejectedValue(new Error(message));
  const error = await provider.generateStructured(req).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: 'http', status, retryable });
  expect(String((error as Error).message)).not.toContain(message);
});

it('rejects a model ID that is not a Workers AI model before calling it', async () => {
  const run = vi.fn<WorkersAiRun>();
  const provider = workersAiProvider({ run, planModel: 'gemini-flash-latest', fastModel: FAST });
  await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'configuration' });
  expect(run).not.toHaveBeenCalled();
});

it('does not stream, so the router serves one complete document', async () => {
  const { run, provider } = setup();
  expect(provider.streamStructured).toBeUndefined();
  run.mockResolvedValue(ok('{"title":"Idea"}'));
  let text = '';
  for await (const chunk of llmRouter([provider]).streamStructured!(req)) text += chunk;
  expect(JSON.parse(text)).toEqual({ title: 'Idea' });
});

it('REST runner posts to the account endpoint and surfaces the error code', async () => {
  const send = vi.fn<typeof fetch>();
  const run = workersAiRest({ accountId: 'a'.repeat(32), apiToken: 'cf-token', fetch: send });
  send.mockResolvedValueOnce(Response.json({ success: true, result: { response: 'x' } }));
  expect(await run(PLAN, { prompt: 'hi' }, {})).toEqual({ response: 'x' });
  expect(send.mock.calls[0]![0]).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/${PLAN}`,
  );
  expect(send.mock.calls[0]![1]!.headers).toMatchObject({ authorization: 'Bearer cf-token' });
  send.mockResolvedValueOnce(
    Response.json({ success: false, errors: [{ code: 3040, message: 'Capacity' }] }, { status: 429 }),
  );
  await expect(run(PLAN, {}, {})).rejects.toThrow('3040');
  expect(() => workersAiRest({ accountId: 'nope', apiToken: 'x' })).toThrow();
});
