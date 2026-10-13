import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Env } from '../../env';
import { mockEmbeddings, mockLlm } from './mock';
import { llmRouter } from './router';
import { LlmError } from './structured';
import { aiProviderStatus } from './status';
import type { LlmProvider, StructuredRequest } from './types';

const env = {
  GEMINI_MODEL_PLAN: 'gemini-plan',
  GEMINI_MODEL_FAST: 'gemini-fast',
  EMBED_MODEL: 'Qwen/Qwen3-Embedding-0.6B',
  EMBED_DIM: '1024',
} as Env;
const configured = { ...env, GEMINI_API_KEY: 'k', HF_TOKEN: 'h' } as Env;
const services = { llm: mockLlm, embeddings: mockEmbeddings(1024) };

describe('aiProviderStatus', () => {
  it('reports deterministic fallbacks when no provider is configured', () => {
    expect(aiProviderStatus(env, services)).toEqual([
      { provider: 'template', role: 'plan', model: 'template', healthy: true, lastErrorAt: null },
      { provider: 'template', role: 'fast', model: 'template', healthy: true, lastErrorAt: null },
      { provider: 'keyword', role: 'embeddings', model: 'keyword', healthy: true, lastErrorAt: null },
    ]);
  });

  it('reports Workers AI ahead of the optional fallbacks when the AI binding is present', () => {
    const withAi = {
      ...configured,
      AI: {} as Ai,
      AI_MODEL_PLAN: '@cf/plan',
      AI_MODEL_FAST: '@cf/fast',
    } as Env;
    expect(aiProviderStatus(withAi, services).map((s) => [s.provider, s.role, s.model])).toEqual([
      ['workers_ai', 'plan', '@cf/plan'],
      ['workers_ai', 'fast', '@cf/fast'],
      ['workers_ai', 'embeddings', 'Qwen/Qwen3-Embedding-0.6B'],
    ]);
  });

  it('reports configured providers and the breaker state of this isolate', async () => {
    expect(aiProviderStatus(configured, services).map((s) => [s.provider, s.role, s.model])).toEqual([
      ['gemini', 'plan', 'gemini-plan'],
      ['gemini', 'fast', 'gemini-fast'],
      ['hf', 'embeddings', 'Qwen/Qwen3-Embedding-0.6B'],
    ]);
    let t = 1_000;
    const failing = {
      name: 'gemini',
      generateStructured: vi.fn(async () => {
        throw new LlmError('response');
      }),
    } as unknown as LlmProvider;
    const llm = llmRouter([failing], { now: () => t, sleep: async () => {} });
    const req: StructuredRequest<z.ZodObject> = {
      task: 'ideas.generate',
      tier: 'plan',
      system: '',
      input: {},
      schema: z.object({}),
    };
    for (let i = 0; i < 3; i++) await expect(llm.generateStructured(req)).rejects.toThrow();
    expect(aiProviderStatus(configured, { ...services, llm })[0]).toMatchObject({
      healthy: false,
      lastErrorAt: new Date(1_000).toISOString(),
    });
    t += 121_000;
    expect(aiProviderStatus(configured, { ...services, llm })[0]?.healthy).toBe(true);
  });
});
