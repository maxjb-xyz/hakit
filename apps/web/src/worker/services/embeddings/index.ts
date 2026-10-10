/**
 * Embedding router (docs/AI.md §2.4): HF router → AMD vLLM (optional) → Workers AI, all Qwen3-Embedding-0.6B / 1024d.
 * Owner: IN. Task: T-205. Needs circuit breaker + content-hash cache (embedding_cache table).
 */
import type { EmbeddingProvider } from '../ai/types';

export function hfEmbeddings(_opts: { token: string; model: string; dim: number }): EmbeddingProvider {
  return {
    name: 'hf',
    model: _opts.model,
    dim: _opts.dim,
    async embed() {
      throw new Error('hfEmbeddings not implemented (T-205)');
    },
  };
}

export function workersAiEmbeddings(ai: Ai, model: string, dim: number): EmbeddingProvider {
  return {
    name: 'workers_ai',
    model,
    dim,
    async embed(texts) {
      // Shape per Workers AI embedding models: { data: number[][] }. Verify for qwen3-embedding (T-205).
      const res = (await ai.run(model as Parameters<Ai['run']>[0], { text: texts } as never)) as {
        data?: number[][];
      };
      if (!res.data) throw new Error('Workers AI returned no embeddings');
      return res.data;
    },
  };
}
