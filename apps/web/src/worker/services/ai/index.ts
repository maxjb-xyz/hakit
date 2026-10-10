import type { Env } from '../../env';
import { geminiProvider } from './gemini';
import { openaiCompatProvider } from './openai-compat';
import { llmRouter } from './router';
import type { LlmProvider } from './types';

const routers = new WeakMap<Env, LlmProvider>();
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
  if (env.AMD_LLM_BASE_URL && env.AMD_LLM_MODEL)
    providers.push(
      openaiCompatProvider({
        baseUrl: env.AMD_LLM_BASE_URL,
        apiKey: env.AMD_LLM_KEY,
        model: env.AMD_LLM_MODEL,
      }),
    );
  const router = llmRouter(providers);
  routers.set(env, router);
  return router;
}
