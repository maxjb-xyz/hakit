/**
 * Provider for opt-in live checks and evals. Workers AI over REST when CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_API_TOKEN (Workers AI read + edit) are set, otherwise Gemini with GEMINI_API_KEY.
 * Reads the environment first, then the repo-root .dev.vars.
 */
import { readFileSync } from 'node:fs';
import { geminiProvider } from '../src/worker/services/ai/gemini';
import type { TransportOptions } from '../src/worker/services/ai/structured';
import type { LlmProvider } from '../src/worker/services/ai/types';
import { workersAiProvider, workersAiRest } from '../src/worker/services/ai/workers-ai';

export function variable(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../../../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.trimStart().startsWith(`${name}=`));
    return line
      ?.slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}

/** Default models match wrangler.jsonc. */
export function liveLlm(opts: Omit<TransportOptions, 'fetch'> = {}): {
  provider: LlmProvider;
  model: string;
} {
  const accountId = variable('CLOUDFLARE_ACCOUNT_ID'),
    apiToken = variable('CLOUDFLARE_API_TOKEN');
  if (accountId && apiToken) {
    const model = variable('AI_MODEL_PLAN') ?? '@cf/meta/llama-4-scout-17b-16e-instruct';
    const run = workersAiRest({ accountId, apiToken });
    return { provider: workersAiProvider({ run, planModel: model, fastModel: model, ...opts }), model };
  }
  const apiKey = variable('GEMINI_API_KEY');
  if (!apiKey)
    throw new Error(
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI) or GEMINI_API_KEY in .dev.vars.',
    );
  const model = variable('GEMINI_MODEL_PLAN') ?? 'gemini-flash-latest';
  return { provider: geminiProvider({ apiKey, planModel: model, fastModel: model, ...opts }), model };
}
