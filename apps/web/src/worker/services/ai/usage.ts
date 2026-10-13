/**
 * Per-workspace daily AI limits, so one team on a shared instance can't spend the whole Cloudflare account's
 * Workers AI allowance (10,000 neurons/day on the free plan).
 *
 * Unit: an "AI unit" is one weighted provider call, charged before the call is made:
 * - plan-tier generation (ideas, plan outline/tasks/repair): 10
 * - fast-tier generation (assignment explanation polish): 2
 * - one embedding request (up to 32 texts) that misses the embedding cache: 1
 * Roughly 1 unit ≈ 15 neurons on the default models: a plan-tier call on Llama 4 Scout (a few thousand
 * tokens in, one to two thousand out) is ~150 neurons, a fast-tier explanation ~30, a 32-text Qwen3
 * embedding request ~10. Calls, not tokens, are counted so the charge happens before the call (tokens are
 * only known afterwards) and a call that doesn't fit is refused instead of overshooting.
 * Retries inside the provider router are not charged again; a call that fails after it was charged still
 * counts (the provider may have billed it).
 *
 * The counter is one `ai_usage` row per workspace per UTC day. A charge is a single guarded UPSERT …
 * RETURNING: it only applies while `units + cost <= limit`, so concurrent requests can never push the
 * counter past the limit. Over the limit, the wrappers throw the same errors the routers throw when every
 * provider is rate limited (LlmError 'unavailable' with status 429, EmbeddingError 'unavailable'), so every
 * caller takes its existing deterministic fallback (template plans and explanations, keyword matching).
 * Quota errors are raised outside the routers and never trip their circuit breakers.
 */
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@hakit/db';
import type { AiUsage } from '@hakit/contracts';
import type { Env } from '../../env';
import { isMock } from '../../env';
import type { Services } from '..';
import { EmbeddingError } from '../embeddings/providers';
import { LlmError } from './structured';
import type { EmbeddingProvider, LlmProvider, StructuredRequest } from './types';

export const AI_UNITS = { plan: 10, fast: 2, embed: 1 } as const;

/** Thrown by metered LLM calls over the daily limit: the router's "all providers rate limited" error. */
export class AiQuotaError extends LlmError {
  constructor() {
    super('unavailable', false, 429);
    this.name = 'AiQuotaError';
  }
}
/** Thrown by metered embedding calls over the daily limit: the router's "all providers unavailable" error. */
export class EmbeddingQuotaError extends EmbeddingError {
  constructor() {
    super('unavailable', 'Workspace daily AI limit reached; use deterministic matching until the reset');
    this.name = 'EmbeddingQuotaError';
  }
}

/** The configured limit in units, or null for unlimited (unset, "0", or not a positive integer). */
export function dailyLimit(env: Pick<Env, 'AI_DAILY_LIMIT_PER_WORKSPACE'>): number | null {
  const raw = env.AI_DAILY_LIMIT_PER_WORKSPACE?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

/** The UTC day a usage row belongs to, 'YYYY-MM-DD'. */
export const usageDay = (now: Date) => now.toISOString().slice(0, 10);
/** Next 00:00 UTC after `now`. */
export const usageResetsAt = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

export interface AiMeter {
  /** Records `units` for today; false (and nothing recorded) when that would exceed the daily limit. */
  charge(units: number): Promise<boolean>;
}

/**
 * Meter for one workspace. `workspace` may be a lookup (jobs that only know a project); it runs on the first
 * charge, and a null result (the workspace or project is gone) charges nothing.
 */
export function workspaceMeter(
  db: Db,
  env: Pick<Env, 'AI_DAILY_LIMIT_PER_WORKSPACE'>,
  workspace: string | (() => Promise<string | null>),
  now: () => Date = () => new Date(),
): AiMeter {
  let resolved: Promise<string | null> | undefined;
  const workspaceId = () =>
    (resolved ??= typeof workspace === 'string' ? Promise.resolve(workspace) : workspace());
  return {
    async charge(units) {
      const wid = await workspaceId();
      if (!wid) return true;
      const limit = dailyLimit(env);
      if (limit !== null && units > limit) return false;
      const t = schema.aiUsage;
      const rows = await db
        .insert(t)
        .values({ workspaceId: wid, day: usageDay(now()), units, calls: 1, updatedAt: now() })
        .onConflictDoUpdate({
          target: [t.workspaceId, t.day],
          set: { units: sql`${t.units} + ${units}`, calls: sql`${t.calls} + 1`, updatedAt: now() },
          // Unlimited workspaces are still counted, for the usage display.
          ...(limit === null ? {} : { setWhere: sql`${t.units} + ${units} <= ${limit}` }),
        })
        .returning({ units: t.units });
      return rows.length > 0;
    },
  };
}

/** Today's usage for the settings screen. */
export async function readUsage(
  db: Db,
  env: Pick<Env, 'AI_DAILY_LIMIT_PER_WORKSPACE'>,
  workspaceId: string,
  now: Date,
): Promise<AiUsage> {
  const day = usageDay(now);
  const [row] = await db
    .select({ units: schema.aiUsage.units })
    .from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.workspaceId, workspaceId), eq(schema.aiUsage.day, day)));
  return {
    day,
    used: row?.units ?? 0,
    limit: dailyLimit(env),
    resetsAt: usageResetsAt(now).toISOString(),
  };
}

/** Charges each structured call by tier before it reaches the provider router. */
export function meteredLlm(llm: LlmProvider, meter: AiMeter): LlmProvider {
  const charge = async (req: StructuredRequest<never>) => {
    if (!(await meter.charge(AI_UNITS[req.tier]))) throw new AiQuotaError();
  };
  const stream = llm.streamStructured?.bind(llm);
  return {
    get name() {
      return llm.name;
    },
    ...(llm.health ? { health: () => llm.health!() } : {}),
    async generateStructured(req) {
      await charge(req as StructuredRequest<never>);
      return llm.generateStructured(req);
    },
    ...(stream
      ? {
          async *streamStructured(req) {
            await charge(req as StructuredRequest<never>);
            yield* stream(req);
          },
        }
      : {}),
  };
}

/**
 * Charges each embedding request that reaches the provider. Wrap the router, under the cache
 * (`embeddingService(env, cache, meter)`), so cache hits are free.
 */
export function meteredEmbeddings(provider: EmbeddingProvider, meter: AiMeter): EmbeddingProvider {
  return {
    get name() {
      return provider.name;
    },
    model: provider.model,
    dim: provider.dim,
    ...(provider.health ? { health: () => provider.health!() } : {}),
    async embed(texts, kind) {
      if (texts.length && !(await meter.charge(AI_UNITS.embed))) throw new EmbeddingQuotaError();
      return provider.embed(texts, kind);
    },
  };
}

/**
 * The request's LLM metered for `workspaceId`. Mock mode is never metered (mock providers cost nothing).
 * Embedding call sites build their own metered `embeddingService` (the meter sits under the cache).
 */
export function workspaceLlm(
  env: Env,
  db: Db,
  services: Pick<Services, 'llm'>,
  workspaceId: string,
): LlmProvider {
  if (isMock(env)) return services.llm;
  return meteredLlm(services.llm, workspaceMeter(db, env, workspaceId));
}
