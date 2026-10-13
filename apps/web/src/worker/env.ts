import type { JobMessage } from '@hakit/contracts';
import type { ProjectRoom } from './do/project-room';

/** Bindings + vars + secrets (wrangler.jsonc, .dev.vars.example). Keep in sync with both. */
export interface Env {
  ASSETS: Fetcher;
  /** Cloudflare D1 (SQLite). Migrations: packages/db/migrations. */
  DB: D1Database;
  PROJECT_ROOM: DurableObjectNamespace<ProjectRoom>;
  JOBS: Queue<JobMessage>;
  /** Per-agent-token ingestion limit (wrangler `ratelimits`). Optional so tests and local dev run without it. */
  AGENT_RATE_LIMITER?: RateLimit;
  /** Workers AI: the default LLM and embedding provider. Optional so tests and mock mode run without it. */
  AI?: Ai;

  /**
   * Public origin. Optional in wrangler vars: `resolveEnv` (lib/instance.ts) fills it from the request origin,
   * so handlers always see a value.
   */
  APP_URL: string;
  /** "1" = fixtures + fake auth + mock providers. */
  HAKIT_MOCKS: string;
  /** Workers AI model IDs (`@cf/…`) for the plan and fast tiers. */
  AI_MODEL_PLAN: string;
  AI_MODEL_FAST: string;
  /** Optional Gemini fallback; only used when GEMINI_API_KEY is set. */
  GEMINI_MODEL_PLAN?: string;
  GEMINI_MODEL_FAST?: string;
  EMBED_MODEL: string;
  EMBED_DIM: string;
  /**
   * Daily AI units per workspace (services/ai/usage.ts: plan-tier call 10, fast-tier 2, embedding request 1),
   * reset at 00:00 UTC. Unset or "0" = unlimited. Over the limit, AI paths use their deterministic fallbacks.
   */
  AI_DAILY_LIMIT_PER_WORKSPACE?: string;

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
  /** E2E only (T-701): "1" plus E2E_LOGIN_SECRET enables POST /auth/test-login. NEVER set in production. */
  E2E_LOGIN_ENABLED?: string;
  E2E_LOGIN_SECRET?: string;
}

export const isMock = (env: Pick<Env, 'HAKIT_MOCKS'>) => env.HAKIT_MOCKS === '1';
