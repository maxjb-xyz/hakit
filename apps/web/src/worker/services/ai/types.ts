import type { z } from 'zod';
import type { AiProviderStatus, AiTaskName } from '@hakit/contracts';

/** Provider-agnostic LLM interface (docs/AI.md intro). Implementations: gemini, openai-compat (AMD), mock. */
export interface StructuredRequest<T extends z.ZodType> {
  task: AiTaskName;
  system: string;
  /** Passed to the model as labeled JSON data, never interpolated prose. */
  input: unknown;
  schema: T;
  tier: 'plan' | 'fast';
  temperature?: number;
}

export interface LlmProvider {
  readonly name: AiProviderStatus['provider'];
  generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.output<T>>;
  /** Streams partial JSON text chunks; caller parses the final result with the schema. */
  streamStructured?<T extends z.ZodType>(req: StructuredRequest<T>): AsyncIterable<string>;
}

export interface EmbeddingProvider {
  readonly name: AiProviderStatus['provider'];
  readonly model: string;
  readonly dim: number;
  embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]>;
}
