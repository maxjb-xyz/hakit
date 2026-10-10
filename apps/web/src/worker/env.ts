import type { JobMessage } from '@hakit/contracts';
import type { ProjectRoom } from './do/project-room';

/** Bindings + vars + secrets (wrangler.jsonc, .dev.vars.example). Keep in sync with both. */
export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
  PROJECT_ROOM: DurableObjectNamespace<ProjectRoom>;
  JOBS: Queue<JobMessage>;
  AI: Ai;
  /** Per-agent-token ingestion limit (wrangler `ratelimits`). Optional so tests and local dev run without it. */
  AGENT_RATE_LIMITER?: RateLimit;

  APP_URL: string;
  /** "1" = fixtures + fake auth + mock providers. */
  HAKIT_MOCKS: string;
  GEMINI_MODEL_PLAN: string;
  GEMINI_MODEL_FAST: string;
  EMBED_MODEL: string;
  EMBED_DIM: string;
  WORKERS_AI_EMBED_MODEL: string;

  SESSION_SECRET?: string;
  TOKEN_ENC_KEY?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GEMINI_API_KEY?: string;
  HF_TOKEN?: string;
  AMD_LLM_BASE_URL?: string;
  AMD_EMBED_BASE_URL?: string;
  AMD_LLM_KEY?: string;
}

export const isMock = (env: Pick<Env, 'HAKIT_MOCKS'>) => env.HAKIT_MOCKS === '1';
