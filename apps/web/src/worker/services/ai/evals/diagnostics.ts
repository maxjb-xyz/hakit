import { LlmError } from '../structured';
import type { LlmProvider } from '../types';

/** Capture typed failures before the router hides them; never retain messages or bodies. */
export function diagnosticProvider(provider: LlmProvider) {
  const failures: { task: string; code: LlmError['code'] | 'unknown'; status?: number }[] = [];
  const wrapped: LlmProvider = {
    name: provider.name,
    async generateStructured(req) {
      try {
        return await provider.generateStructured(req);
      } catch (error) {
        failures.push({
          task: req.task,
          code: error instanceof LlmError ? error.code : 'unknown',
          ...(error instanceof LlmError && error.status !== undefined ? { status: error.status } : {}),
        });
        throw error;
      }
    },
  };
  return { provider: wrapped, failures };
}
