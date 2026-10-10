import type { z } from 'zod';
import type { LlmProvider, StructuredRequest } from './types';
import { LlmError } from './structured';

/** Breakers survive calls in a warm isolate; real mode never returns fixture plans. */
export function llmRouter(
  providers: LlmProvider[],
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): LlmProvider {
  const now = opts.now ?? Date.now,
    sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const states = providers.map(() => ({ failures: [] as number[], openUntil: 0, probing: false }));
  let selected = providers[0]?.name ?? 'gemini';
  const eligible = (i: number) => {
    const state = states[i]!;
    if (state.openUntil > now() || state.probing) return false;
    state.probing = state.openUntil !== 0;
    return true;
  };
  const success = (i: number) => {
    states[i] = { failures: [], openUntil: 0, probing: false };
    selected = providers[i]!.name;
  };
  const failure = (i: number) => {
    const state = states[i]!;
    state.failures = state.failures.filter((time) => now() - time < 60_000);
    state.failures.push(now());
    if (state.probing || state.failures.length >= 3) state.openUntil = now() + 120_000;
    state.probing = false;
  };
  return {
    get name() {
      return selected;
    },
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.output<T>> {
      let lastStatus: number | undefined;
      for (const [i, provider] of providers.entries()) {
        if (!eligible(i)) continue;
        for (let retry = 0; retry < 4; retry++) {
          try {
            const result = req.schema.parse(await provider.generateStructured(req));
            success(i);
            return result;
          } catch (error) {
            if (error instanceof LlmError) lastStatus = error.status;
            // Timeouts already consumed the call budget; do not repeat a slow call.
            if (error instanceof LlmError && error.retryable && error.code !== 'timeout' && retry < 3) {
              await sleep(1000 * 2 ** retry);
              continue;
            }
            failure(i);
            break;
          }
        }
      }
      throw new LlmError('unavailable', false, lastStatus);
    },
    async *streamStructured(req) {
      let lastStatus: number | undefined;
      for (const [i, provider] of providers.entries()) {
        if (!eligible(i)) continue;
        for (let retry = 0; retry < 4; retry++) {
          let emitted = false,
            text = '';
          try {
            if (provider.streamStructured) {
              for await (const chunk of provider.streamStructured(req)) {
                text += chunk;
                emitted = true;
                yield chunk;
              }
              req.schema.parse(JSON.parse(text));
            } else {
              text = JSON.stringify(req.schema.parse(await provider.generateStructured(req)));
              emitted = true;
              yield text;
            }
            success(i);
            return;
          } catch (error) {
            if (error instanceof LlmError) lastStatus = error.status;
            // Retrying is safe only before the consumer has received any JSON text.
            if (
              !emitted &&
              error instanceof LlmError &&
              error.retryable &&
              error.code !== 'timeout' &&
              retry < 3
            ) {
              await sleep(1000 * 2 ** retry);
              continue;
            }
            failure(i);
            // Never append a second provider's JSON to an already visible partial document.
            if (emitted) throw new LlmError('response');
            break;
          } finally {
            // Keep a recovery probe exclusive throughout its retry/backoff loop.
            if (emitted) states[i]!.probing = false;
          }
        }
        states[i]!.probing = false;
      }
      throw new LlmError('unavailable', false, lastStatus);
    },
  };
}
