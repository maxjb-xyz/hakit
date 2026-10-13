import type { Env } from '../../env';
import { geminiProvider } from './gemini';
import { llmRouter } from './router';
import type { LlmProvider } from './types';
import { workersAiProvider, type WorkersAiRun } from './workers-ai';

export const GEMINI_DEFAULT_PLAN = 'gemini-flash-latest';
export const GEMINI_DEFAULT_FAST = 'gemini-flash-lite-latest';

/** The `AI` binding as a plain runner (its typings are keyed per model ID; ours come from config). */
export const bindingRun =
  (ai: Ai): WorkersAiRun =>
  (model, inputs, options) =>
    (ai.run as (m: string, i: unknown, o: unknown) => Promise<unknown>)(model, inputs, options);

/** The model ID that generates plans, for prompt-cache keys: Workers AI unless only Gemini is configured. */
export const planModelId = (env: Env) =>
  !env.AI && env.GEMINI_API_KEY ? (env.GEMINI_MODEL_PLAN ?? GEMINI_DEFAULT_PLAN) : env.AI_MODEL_PLAN;

const routers = new WeakMap<Env, LlmProvider>();
/**
 * Workers AI (the `AI` binding) first, then Gemini if GEMINI_API_KEY is set. With neither the router
 * reports `unavailable` and callers use templates.
 */
export function llmService(env: Env): LlmProvider {
  const cached = routers.get(env);
  if (cached) return cached;
  const providers: LlmProvider[] = [];
  if (env.AI)
    providers.push(
      workersAiProvider({
        run: bindingRun(env.AI),
        planModel: env.AI_MODEL_PLAN,
        fastModel: env.AI_MODEL_FAST,
      }),
    );
  if (env.GEMINI_API_KEY)
    providers.push(
      geminiProvider({
        apiKey: env.GEMINI_API_KEY,
        planModel: env.GEMINI_MODEL_PLAN ?? GEMINI_DEFAULT_PLAN,
        fastModel: env.GEMINI_MODEL_FAST ?? GEMINI_DEFAULT_FAST,
      }),
    );
  const router = llmRouter(providers);
  routers.set(env, router);
  return router;
}
