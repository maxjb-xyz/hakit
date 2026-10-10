import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IdeaCandidates } from '@hakit/contracts';
import { geminiProvider } from './gemini';
import { mockLlm } from './mock';
import { sseData } from './structured';
import type { StructuredRequest } from './types';
const schema = z.object({ title: z.string().min(1) });
const req: StructuredRequest<typeof schema> = {
  task: 'ideas.generate',
  tier: 'plan',
  system: 'Return an idea',
  input: { privateNote: 'do-not-log' },
  schema,
};
const gemini = (text = '{"title":"Idea"}', finishReason = 'STOP') => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
});
const setup = (timeoutMs?: number | { plan?: number; fast?: number }) => {
  const send = vi.fn<typeof fetch>(),
    log = vi.fn();
  const provider = geminiProvider({
    apiKey: 'test-secret',
    planModel: 'gemini-3.8-flash',
    fastModel: 'gemini-3.8-flash',
    fetch: send,
    log,
    timeoutMs,
  });
  return { send, log, provider, envelope: gemini };
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function collect(stream: AsyncIterable<string>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}
const streamResponse = (data: string) => {
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};
it.each(['gemini'] as const)(
  '%s serializes structured data and records only safe call metadata',
  async (kind) => {
    const { send, log, provider, envelope } = setup();
    send.mockResolvedValue(response(envelope()));
    expect(await provider.generateStructured(req)).toEqual({ title: 'Idea' });
    const [url, options] = send.mock.calls[0]!;
    const body = JSON.parse(options!.body as string);
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(options!.redirect).toBe('error');
    expect(JSON.stringify(body)).toContain('do-not-log');
    expect(kind).toBe('gemini');
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
    });
    expect(options!.headers).toMatchObject({ 'x-goog-api-key': 'test-secret' });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        task: req.task,
        inputTokens: 12,
        outputTokens: 8,
        validationPassed: true,
        inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/do-not-log|test-secret|Return an idea/);
  },
);
it.each(['gemini'] as const)('%s repairs JSON/schema failures once with validation issues', async (kind) => {
  const { send, log, provider, envelope } = setup();
  send.mockResolvedValueOnce(response(envelope('{"title":12}'))).mockResolvedValueOnce(response(envelope()));
  expect(await provider.generateStructured(req)).toEqual({ title: 'Idea' });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]![1]!.body).toContain('invalid_type');
  expect(send.mock.calls[1]![1]!.body).toContain('title');
  expect(log.mock.calls.map(([record]) => record.validationPassed)).toEqual([false, true]);
});
it.each(['gemini'] as const)('%s rejects two invalid responses without unbounded repairs', async (kind) => {
  const { send, provider, envelope } = setup();
  send.mockImplementation(async () => response(envelope('not JSON')));
  await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'validation' });
  expect(send).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 429, 500])('classifies HTTP %s without exposing upstream bodies', async (status) => {
  const { send, provider } = setup();
  send.mockResolvedValue(new Response('secret provider error', { status }));
  await expect(provider.generateStructured(req)).rejects.toMatchObject({
    code: 'http',
    status,
    retryable: status >= 429,
  });
  expect(send).toHaveBeenCalledTimes(1);
});
it('uses HIGH for outlines and LOW for repair/fast calls', async () => {
  const { send, provider } = setup();
  send.mockImplementation(async () => response(gemini()));
  await provider.generateStructured({ ...req, task: 'plan.outline' });
  await provider.generateStructured({ ...req, task: 'plan.repair' });
  await provider.generateStructured({ ...req, task: 'team.summary', tier: 'fast' });
  expect(
    send.mock.calls.map(
      ([, opts]) => JSON.parse(opts!.body as string).generationConfig.thinkingConfig.thinkingLevel,
    ),
  ).toEqual(['HIGH', 'LOW', 'LOW']);
});
it.each(['MAX_TOKENS', 'SAFETY'])(
  'rejects Gemini %s without trying to repair incomplete/blocked content',
  async (finish) => {
    const { send, provider } = setup();
    send.mockResolvedValue(response(gemini('{"title":"partial"}', finish)));
    await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'response' });
    expect(send).toHaveBeenCalledTimes(1);
  },
);
it('rejects blocked, missing and malformed provider envelopes', async () => {
  for (const value of [{ promptFeedback: { blockReason: 'SAFETY' } }, {}, { candidates: 'bad' }]) {
    const { send, provider } = setup();
    send.mockResolvedValue(response(value));
    await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'response' });
  }
});
it('ignores thought parts instead of treating them as output JSON', async () => {
  const { send, provider } = setup();
  send.mockResolvedValue(
    response({
      candidates: [
        {
          content: { parts: [{ thought: true, text: 'not JSON' }, { text: '{"title":"Idea"}' }] },
          finishReason: 'STOP',
        },
      ],
    }),
  );
  expect(await provider.generateStructured(req)).toEqual({ title: 'Idea' });
});
it('streams Gemini SSE across byte boundaries and validates the final document', async () => {
  const { send, log, provider } = setup();
  send.mockResolvedValue(
    streamResponse(
      `: ping\r\n\r\ndata: ${JSON.stringify(gemini('{"title":', undefined as unknown as string)).replace(',"finishReason":"STOP"', '')}\r\n\r\ndata: ${JSON.stringify(gemini('"Idéa"}'))}\r\n\r\n`,
    ),
  );
  expect(await collect(provider.streamStructured!(req))).toBe('{"title":"Idéa"}');
  expect(send.mock.calls[0]![0]).toContain('streamGenerateContent?alt=sse');
  expect(log.mock.calls[0]![0].validationPassed).toBe(true);
});
it('rejects invalid streamed JSON without emitting a replacement document', async () => {
  const { send, provider } = setup();
  send.mockResolvedValue(streamResponse(`data: ${JSON.stringify(gemini('not JSON'))}\n\n`));
  await expect(collect(provider.streamStructured!(req))).rejects.toMatchObject({ code: 'validation' });
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects abruptly terminated streams even when partial JSON is syntactically valid', async () => {
  const { send, provider } = setup();
  send.mockResolvedValue(streamResponse('data: {"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}\n\n'));
  await expect(collect(provider.streamStructured!(req))).rejects.toMatchObject({ code: 'response' });
});
it('supports multiline SSE data and a final frame without a trailing newline', async () => {
  expect(
    await collect(
      sseData(streamResponse('data: hello\r\ndata: world\r\n\r\ndata: last'), new AbortController().signal),
    ),
  ).toBe('hello\nworldlast');
});
it('times out a stalled response body and sanitizes network failures', async () => {
  const { send, provider } = setup(10);
  send.mockResolvedValue(
    new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }),
  );
  await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'timeout' });
  send.mockRejectedValue(new Error('test-secret do-not-log'));
  await expect(provider.generateStructured(req)).rejects.toMatchObject({
    message: 'AI provider error: response',
  });
});
it('bounds request and response size and validates temperatures', async () => {
  const { send, provider } = setup();
  await expect(provider.generateStructured({ ...req, input: 'a'.repeat(262_145) })).rejects.toMatchObject({
    code: 'configuration',
  });
  await expect(provider.generateStructured({ ...req, temperature: NaN })).rejects.toMatchObject({
    code: 'configuration',
  });
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValue(new Response('a'.repeat(1_048_577)));
  await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'response' });
});
it('does not allow logging failures to break valid output', async () => {
  const provider = geminiProvider({
    apiKey: 'x',
    planModel: 'gemini-3.8-flash',
    fastModel: 'gemini-3.8-flash',
    fetch: vi.fn(async () => response(gemini())),
    log() {
      throw new Error('offline');
    },
  });
  expect(await provider.generateStructured(req)).toEqual({ title: 'Idea' });
});
it('rejects missing credentials and malformed model IDs lazily', async () => {
  const bad = geminiProvider({ apiKey: '', planModel: 'bad/path', fastModel: '', log: vi.fn() });
  await expect(bad.generateStructured(req)).rejects.toMatchObject({ code: 'configuration' });
});
it('gives the plan tier a longer default timeout than the fast tier', async () => {
  const spy = vi.spyOn(globalThis, 'setTimeout');
  try {
    const { send, provider } = setup();
    send.mockImplementation(async () => response(gemini()));
    await provider.generateStructured({ ...req, tier: 'fast' });
    await provider.generateStructured(req);
    const delays = spy.mock.calls.map(([, ms]) => ms);
    expect(delays).toContain(30_000);
    expect(delays).toContain(120_000);
  } finally {
    spy.mockRestore();
  }
});
it('accepts per-tier timeout overrides and rejects invalid ones', () => {
  expect(() => setup({ plan: 0 })).toThrow();
  expect(() => setup({ fast: 5_000 })).not.toThrow();
});
it('returns schema-validated fixture ideas in mock mode without keys', async () => {
  expect((await mockLlm.generateStructured({ ...req, schema: IdeaCandidates })).ideas).toHaveLength(1);
  await expect(mockLlm.generateStructured({ ...req, task: 'team.summary' })).rejects.toThrow('no fixture');
});
