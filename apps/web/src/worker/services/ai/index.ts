import type { Env } from '../../env';
import { geminiProvider } from './gemini';
import { llmRouter } from './router';
import type { LlmProvider } from './types';

const routers = new WeakMap<Env, LlmProvider>();
/** Gemini is the only LLM API. Without a key the router reports `unavailable` and callers use templates. */
export function llmService(env: Env): LlmProvider {
  const cached = routers.get(env);
  if (cached) return cached;
  const providers: LlmProvider[] = [];
  if (env.GEMINI_API_KEY)
    providers.push(
      geminiProvider({
        apiKey: env.GEMINI_API_KEY,
        planModel: env.GEMINI_MODEL_PLAN,
        fastModel: env.GEMINI_MODEL_FAST,
      }),
    );
  const router = llmRouter(providers);
  routers.set(env, router);
  return router;
}
