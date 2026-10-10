import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { llmRouter } from './router';
import { LlmError } from './structured';
import { llmService } from './index';
import type { Env } from '../../env';
import type { LlmProvider } from './types';
const req = {
  task: 'ideas.generate' as const,
  tier: 'plan' as const,
  system: '',
  input: {},
  schema: z.object({ ok: z.boolean() }),
};
const fake = (name: LlmProvider['name'], generate = vi.fn(async () => ({ ok: true }))) =>
  ({ name, generateStructured: generate }) as unknown as LlmProvider;
it('uses the primary, validates output and avoids unnecessary fallback', async () => {
  const a = fake('gemini'),
    b = fake('template');
  const router = llmRouter([a, b]);
  expect(await router.generateStructured(req)).toEqual({ ok: true });
  expect(router.name).toBe('gemini');
  expect(b.generateStructured).not.toHaveBeenCalled();
});
it('falls back on invalid provider output and reports the actual selected provider', async () => {
  const a = fake('gemini', vi.fn(async () => ({ bad: true })) as never),
    b = fake('template');
  const router = llmRouter([a, b]);
  expect(await router.generateStructured(req)).toEqual({ ok: true });
  expect(router.name).toBe('template');
});
it('retries transient failures at 1/2/4 seconds before falling back', async () => {
  const generate = vi.fn(async () => {
    throw new LlmError('http', true, 429);
  });
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {}),
    b = fake('template');
  expect(await llmRouter([fake('gemini', generate), b], { sleep }).generateStructured(req)).toEqual({
    ok: true,
  });
  expect(generate).toHaveBeenCalledTimes(4);
  expect(sleep.mock.calls.map((args) => args[0])).toEqual([1000, 2000, 4000]);
});
it('does not retry unauthorized or timed-out calls', async () => {
  for (const error of [new LlmError('http', false, 401), new LlmError('timeout', true)]) {
    const generate = vi.fn(async () => {
      throw error;
    });
    await llmRouter([fake('gemini', generate), fake('template')]).generateStructured(req);
    expect(generate).toHaveBeenCalledTimes(1);
  }
});
it('opens after three failed calls and allows only one recovery probe', async () => {
  let clock = 0;
  const generate = vi.fn(async () => {
    throw new LlmError('response');
  });
  const router = llmRouter([fake('gemini', generate), fake('template')], { now: () => clock });
  for (let i = 0; i < 4; i++) await router.generateStructured(req);
  expect(generate).toHaveBeenCalledTimes(3);
  clock = 120_001;
  let release!: (value: { ok: boolean }) => void;
  generate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }) as never,
  );
  const probe = router.generateStructured(req);
  await router.generateStructured(req);
  expect(generate).toHaveBeenCalledTimes(4);
  release({ ok: true });
  await probe;
  await router.generateStructured(req);
  expect(generate).toHaveBeenCalledTimes(5);
});
it('failure counts expire and failed recovery reopens the breaker', async () => {
  let clock = 0;
  const generate = vi.fn(async () => {
    throw new LlmError('response');
  });
  const router = llmRouter([fake('gemini', generate), fake('template')], { now: () => clock });
  await router.generateStructured(req);
  clock = 60_001;
  for (let i = 0; i < 3; i++) await router.generateStructured(req);
  expect(generate).toHaveBeenCalledTimes(4);
  clock += 120_001;
  await router.generateStructured(req);
  await router.generateStructured(req);
  expect(generate).toHaveBeenCalledTimes(5);
});
it('returns a typed unavailable error instead of a fixture in real mode', async () => {
  await expect(llmRouter([]).generateStructured(req)).rejects.toMatchObject({ code: 'unavailable' });
  const env = {} as Env;
  expect(llmService(env)).toBe(llmService(env));
  await expect(llmService(env).generateStructured(req)).rejects.toMatchObject({ code: 'unavailable' });
});
it('falls back before streaming output but never mixes documents after a partial emission', async () => {
  const b = fake('template');
  const a: LlmProvider = {
    ...fake('gemini'),
    async *streamStructured() {
      throw new Error('private details');
      yield '';
    },
  };
  let text = '';
  for await (const chunk of llmRouter([a, b]).streamStructured!(req)) text += chunk;
  expect(JSON.parse(text)).toEqual({ ok: true });
  const partial: LlmProvider = {
    ...fake('gemini'),
    async *streamStructured() {
      yield '{';
      throw new Error('private');
    },
  };
  b.generateStructured = vi.fn() as never;
  await expect(
    (async () => {
      for await (const chunk of llmRouter([partial, b]).streamStructured!(req)) text += chunk;
    })(),
  ).rejects.toMatchObject({ code: 'response' });
  expect(b.generateStructured).not.toHaveBeenCalled();
});
it.each([503, 429])(
  'retries streaming HTTP %s before output and then returns one complete document',
  async (status) => {
    let calls = 0;
    const provider: LlmProvider = {
      ...fake('gemini'),
      async *streamStructured() {
        calls++;
        if (calls === 1) throw new LlmError('http', true, status);
        yield '{"ok":true}';
      },
    };
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    let text = '';
    for await (const chunk of llmRouter([provider], { sleep }).streamStructured!(req)) text += chunk;
    expect(text).toBe('{"ok":true}');
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  },
);
it('bounds streaming retries and retains the HTTP status when the provider stays unavailable', async () => {
  let calls = 0;
  const provider: LlmProvider = {
    ...fake('gemini'),
    async *streamStructured() {
      calls++;
      throw new LlmError('http', true, 503);
      yield '';
    },
  };
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  await expect(
    (async () => {
      for await (const chunk of llmRouter([provider], { sleep }).streamStructured!(req)) void chunk;
    })(),
  ).rejects.toMatchObject({ code: 'unavailable', status: 503 });
  expect(calls).toBe(4);
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
});
it('does not retry a transient error after partial streaming output', async () => {
  let calls = 0;
  const provider: LlmProvider = {
    ...fake('gemini'),
    async *streamStructured() {
      calls++;
      yield '{';
      throw new LlmError('http', true, 503);
    },
  };
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {}),
    fallback = fake('template');
  await expect(
    (async () => {
      for await (const chunk of llmRouter([provider, fallback], { sleep }).streamStructured!(req)) void chunk;
    })(),
  ).rejects.toMatchObject({ code: 'response' });
  expect(calls).toBe(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(fallback.generateStructured).not.toHaveBeenCalled();
});
it('does not let schema-invalid answers switch the provider off', async () => {
  const generate = vi.fn(async () => {
    throw new LlmError('validation');
  });
  const router = llmRouter([fake('gemini', generate)]);
  for (let i = 0; i < 5; i++)
    await expect(router.generateStructured(req)).rejects.toMatchObject({ code: 'unavailable' });
  // Every call still reached Gemini: bad output is not an outage.
  expect(generate).toHaveBeenCalledTimes(5);
  generate.mockResolvedValueOnce({ ok: true } as never);
  await expect(router.generateStructured(req)).resolves.toEqual({ ok: true });
});
