import type { Env } from '../env';
import { isMock } from '../env';
import type { EmbeddingProvider, LlmProvider } from './ai/types';
import { mockEmbeddings, mockLlm } from './ai/mock';
import { geminiProvider } from './ai/gemini';
import { embeddingService } from './embeddings';
import { githubService, mockGithub, type GithubService } from './github';

export interface Services {
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  github: GithubService;
}

/** Single switch point between real and mock providers. Routes/jobs only ever use c.var.services. */
export function getServices(env: Env): Services {
  const dim = Number(env.EMBED_DIM);
  if (isMock(env)) return { llm: mockLlm, embeddings: mockEmbeddings(dim), github: mockGithub };
  return {
    // TODO(T-301): router with AMD fallback + circuit breaker.
    llm: geminiProvider({
      apiKey: env.GEMINI_API_KEY ?? '',
      planModel: env.GEMINI_MODEL_PLAN,
      fastModel: env.GEMINI_MODEL_FAST,
    }),
    embeddings: embeddingService(env),
    github: githubService(env),
  };
}
