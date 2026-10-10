import type { Env } from '../env';
import { isMock } from '../env';
import type { EmbeddingProvider, LlmProvider } from './ai/types';
import { mockEmbeddings, mockLlm } from './ai/mock';
import { llmService } from './ai';
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
    llm: llmService(env),
    embeddings: embeddingService(env),
    github: githubService(env),
  };
}
