import { expect, it, vi } from 'vitest';
import {
  QUERY_INSTRUCTION,
  QWEN_DIM,
  QWEN_MODEL,
  WORKERS_AI_QWEN_MODEL,
  workersAiEmbeddings,
} from './providers';

const vector = () => Array.from({ length: QWEN_DIM }, (_, i) => (i === 0 ? 2 : 0));
const setup = () => {
  const run = vi.fn();
  return { run, provider: workersAiEmbeddings({ run, model: QWEN_MODEL, dim: QWEN_DIM }) };
};

it('embeds through the Workers AI Qwen3 model with the same query instruction as Hugging Face', async () => {
  const { run, provider } = setup();
  run.mockResolvedValue({ shape: [2, QWEN_DIM], data: [vector(), vector()] });
  const vectors = await provider.embed(['react', 'postgres'], 'query');
  expect(provider.name).toBe('workers_ai');
  expect(run).toHaveBeenCalledWith(
    WORKERS_AI_QWEN_MODEL,
    { text: [QUERY_INSTRUCTION + 'react', QUERY_INSTRUCTION + 'postgres'] },
    { signal: expect.any(AbortSignal) },
  );
  expect(vectors[0]![0]).toBe(1);
});

it('sends documents as plain text', async () => {
  const { run, provider } = setup();
  run.mockResolvedValue({ data: [vector()] });
  await provider.embed(['a task'], 'document');
  expect(run.mock.calls[0]![1]).toEqual({ text: ['a task'] });
});

it('rejects wrong shapes and hides provider messages', async () => {
  const { run, provider } = setup();
  run.mockResolvedValueOnce({ data: [[1, 2, 3]] });
  await expect(provider.embed(['x'], 'document')).rejects.toMatchObject({ code: 'invalid_output' });
  run.mockRejectedValueOnce(new Error('3040: secret upstream detail'));
  const error = await provider.embed(['x'], 'document').catch((e: unknown) => e);
  expect(error).toMatchObject({ code: 'provider_failed' });
  expect(String(error)).not.toContain('secret upstream detail');
});

it('only serves the Qwen3 model the database vectors were built with', () => {
  expect(() => workersAiEmbeddings({ run: vi.fn(), model: 'other', dim: QWEN_DIM })).toThrow(
    /Qwen3-Embedding-0.6B/,
  );
});
