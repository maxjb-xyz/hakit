import { z } from 'zod';
import type { EmbeddingProvider } from '../ai/types';

export const QWEN_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
export const QWEN_DIM = 1024;
export const QUERY_INSTRUCTION =
  'Instruct: Given a software task, retrieve developers whose skills match\nQuery: ';
export const MAX_BATCH = 32;
export const TIMEOUT_MS = 15_000;
const textsSchema = z
  .array(
    z
      .string()
      .max(16_000)
      .refine((text) => text.trim().length > 0),
  )
  .max(MAX_BATCH);

type ErrorCode = 'invalid_input' | 'invalid_output' | 'provider_failed' | 'unavailable' | 'configuration';
export class EmbeddingError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'EmbeddingError';
  }
}
export function validateTexts(texts: string[], kind: 'query' | 'document'): string[] {
  if ((kind !== 'query' && kind !== 'document') || !textsSchema.safeParse(texts).success) {
    throw new EmbeddingError(
      'invalid_input',
      'Embeddings require query/document text, at most 32 nonempty strings of 16000 characters',
    );
  }
  return texts;
}
export function prepareTexts(texts: string[], kind: 'query' | 'document'): string[] {
  validateTexts(texts, kind);
  return texts.map((text) => (kind === 'query' ? QUERY_INSTRUCTION + text : text));
}
/** One finite, nonzero vector per input, normalized consistently across providers. */
export function validateVectors(value: unknown, count: number, dim: number): number[][] {
  const parsed = z.array(z.array(z.number().finite()).length(dim)).length(count).safeParse(value);
  if (!parsed.success)
    throw new EmbeddingError('invalid_output', 'Embedding response has invalid shape, dimension, or numbers');
  return parsed.data.map((vector) => {
    const norm = Math.hypot(...vector);
    if (!Number.isFinite(norm) || norm === 0)
      throw new EmbeddingError(
        'invalid_output',
        'Embedding response contains a zero or unnormalizable vector',
      );
    return vector.map((number) => number / norm);
  });
}
const responseSchema = z.object({
  model: z.string().optional(),
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) })),
});
export function openAiVectors(value: unknown, count: number, dim: number, model: string): number[][] {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new EmbeddingError('invalid_output', 'Invalid embedding response');
  if (parsed.data.model !== undefined && parsed.data.model !== model)
    throw new EmbeddingError('invalid_output', 'Embedding response model does not match configured model');
  const rows = [...parsed.data.data].sort((a, b) => a.index - b.index);
  if (rows.some((row, i) => row.index !== i))
    throw new EmbeddingError('invalid_output', 'Embedding response indices are missing or duplicated');
  return validateVectors(
    rows.map((row) => row.embedding),
    count,
    dim,
  );
}
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EmbeddingError('provider_failed', 'Embedding provider timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function httpProvider(opts: {
  name: 'hf';
  url: string;
  token: string;
  model: string;
  dim: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): EmbeddingProvider {
  return {
    name: opts.name,
    model: opts.model,
    dim: opts.dim,
    async embed(texts, kind) {
      const input = prepareTexts(texts, kind);
      if (!input.length) return [];
      if (!opts.token) throw new EmbeddingError('configuration', 'Embedding provider token is missing');
      try {
        return await withTimeout(async (signal) => {
          const response = await (opts.fetch ?? fetch)(opts.url, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: opts.model, input, encoding_format: 'float' }),
          });
          if (!response.ok)
            throw new EmbeddingError(
              'provider_failed',
              `${opts.name} embedding request failed (HTTP ${response.status})`,
            );
          return openAiVectors(await response.json(), input.length, opts.dim, opts.model);
        }, opts.timeoutMs);
      } catch (error) {
        if (error instanceof EmbeddingError) throw error;
        // Never propagate provider bodies, credentials, request text or fetch URLs.
        throw new EmbeddingError('provider_failed', `${opts.name} embedding request failed`);
      }
    },
  };
}
/** HF's official DeepInfra adapter uses this routed OpenAI-compatible endpoint. */
export function hfEmbeddings(opts: {
  token: string;
  model: string;
  dim: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): EmbeddingProvider {
  return httpProvider({
    ...opts,
    name: 'hf',
    url: 'https://router.huggingface.co/deepinfra/v1/openai/embeddings',
  });
}
