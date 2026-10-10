/**
 * Gemini provider (docs/INTEGRATIONS.md §3). Owner: IN. Task: T-301.
 * Use @google/genai ^2.28 <3 or raw REST; responseMimeType=application/json + responseJsonSchema = toGeminiSchema(schema);
 * thinkingLevel (not thinkingBudget) on 3.x; re-validate with Zod; one repair retry with the issues appended.
 */
import type { LlmProvider } from './types';

export function geminiProvider(_opts: { apiKey: string; planModel: string; fastModel: string }): LlmProvider {
  return {
    name: 'gemini',
    async generateStructured() {
      throw new Error('geminiProvider not implemented (T-301)');
    },
  };
}
