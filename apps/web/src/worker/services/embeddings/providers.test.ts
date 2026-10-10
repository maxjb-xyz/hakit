import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmbeddingError,
  hfEmbeddings,
  openAiVectors,
  prepareTexts,
  QUERY_INSTRUCTION,
  QWEN_DIM,
  QWEN_MODEL,
  validateVectors,
} from './providers';

const vector = () => Array.from({ length: QWEN_DIM }, (_, i) => (i === 0 ? 2 : 0));
const payload = (count = 1) => ({
  model: QWEN_MODEL,
  data: Array.from({ length: count }, (_, index) => ({ index, embedding: vector() })),
});
const mockFetch = () => vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload()));
const options = (fetch = mockFetch()) => ({
  token: 'private-test-token',
  model: QWEN_MODEL,
  dim: QWEN_DIM,
  fetch,
});
afterEach(() => vi.useRealTimers());

describe('embedding providers', () => {
  it('calls HF DeepInfra through the HF router with a query instruction', async () => {
    const opts = options();
    const provider = hfEmbeddings(opts);
    const [result] = await provider.embed(['Build React UI'], 'query');
    expect(opts.fetch).toHaveBeenCalledWith(
      'https://router.huggingface.co/deepinfra/v1/openai/embeddings',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer private-test-token' }),
      }),
    );
    const body = JSON.parse(opts.fetch.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      model: QWEN_MODEL,
      input: [QUERY_INSTRUCTION + 'Build React UI'],
      encoding_format: 'float',
    });
    expect(result).toHaveLength(1024);
    expect(result![0]).toBe(1);
  });
  it('leaves documents unchanged and returns empty batches without network calls', async () => {
    const opts = options();
    const provider = hfEmbeddings(opts);
    await provider.embed(['React developer'], 'document');
    expect(JSON.parse(opts.fetch.mock.calls[0]![1]!.body as string).input).toEqual(['React developer']);
    expect(await provider.embed([], 'document')).toEqual([]);
    expect(opts.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[''], [' '], ['a'.repeat(16_001)], Array(33).fill('text')])(
    'rejects invalid input before network access',
    async (...texts) => {
      const opts = options();
      await expect(hfEmbeddings(opts).embed(texts, 'query')).rejects.toMatchObject({ code: 'invalid_input' });
      expect(opts.fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid kinds and missing tokens', async () => {
    expect(() => prepareTexts(['a'], 'other' as 'query')).toThrow(EmbeddingError);
    await expect(hfEmbeddings({ ...options(), token: '' }).embed(['a'], 'query')).rejects.toMatchObject({
      code: 'configuration',
    });
  });
  it('sorts response indices back into request order', () => {
    const first = vector();
    const second = vector();
    second[0] = 0;
    second[1] = 2;
    const result = openAiVectors(
      {
        data: [
          { index: 1, embedding: second },
          { index: 0, embedding: first },
        ],
      },
      2,
      1024,
      QWEN_MODEL,
    );
    expect(result[0]![0]).toBe(1);
    expect(result[1]![1]).toBe(1);
  });
  it.each([
    null,
    [],
    { data: [] },
    { data: [{ index: 1, embedding: vector() }] },
    {
      data: [
        { index: 0, embedding: vector() },
        { index: 0, embedding: vector() },
      ],
    },
    { model: 'different', data: [{ index: 0, embedding: vector() }] },
    { data: [{ index: 0, embedding: [1, 2] }] },
  ])('rejects malformed OpenAI responses', (data) =>
    expect(() => openAiVectors(data, 1, 1024, QWEN_MODEL)).toThrow(EmbeddingError),
  );
  it.each(
    [Array(1024).fill(0), [...vector().slice(1), NaN], [...vector().slice(1), Infinity]].map((data) => [
      data,
    ]),
  )('rejects nonfinite or zero vectors', (data) =>
    expect(() => validateVectors([data], 1, 1024)).toThrow(EmbeddingError),
  );
  it('does not leak upstream response bodies or network errors', async () => {
    const opts = options();
    opts.fetch.mockResolvedValue(new Response('private-test-token secret text', { status: 401 }));
    await expect(hfEmbeddings(opts).embed(['private prompt'], 'query')).rejects.toThrow('HTTP 401');
    opts.fetch.mockRejectedValue(new Error('private-test-token private prompt'));
    await expect(hfEmbeddings(opts).embed(['private prompt'], 'query')).rejects.toThrow(
      /^hf embedding request failed$/,
    );
  });
  it('times out a hung HTTP request and aborts its signal', async () => {
    vi.useFakeTimers();
    const opts = options();
    opts.fetch.mockImplementation(() => new Promise(() => {}));
    const failed = expect(hfEmbeddings(opts).embed(['a'], 'query')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(opts.fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});
