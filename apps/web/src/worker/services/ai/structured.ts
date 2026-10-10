import type { z } from 'zod';
import { AiTaskName } from '@hakit/contracts';
import type { LlmProvider, StructuredRequest } from './types';

export class LlmError extends Error {
  constructor(
    readonly code: 'configuration' | 'http' | 'timeout' | 'response' | 'validation' | 'unavailable',
    readonly retryable = false,
    readonly status?: number,
    readonly issues?: string,
  ) {
    super(`AI provider error: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'LlmError';
  }
}
export interface CallRecord {
  task: StructuredRequest<z.ZodType>['task'];
  provider: LlmProvider['name'];
  model: string;
  latencyMs: number;
  inputHash: string;
  inputTokens: number;
  outputTokens: number;
  validationPassed: boolean;
  repair: boolean;
}
export interface TransportOptions {
  fetch?: typeof fetch;
  /** One limit for both tiers, or per tier. Defaults: plan 120 s (long reasoning), fast 30 s. */
  timeoutMs?: number | { plan?: number; fast?: number };
  log?: (record: CallRecord) => void;
}
export interface WireResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  complete: boolean;
}
export interface Wire {
  name: LlmProvider['name'];
  model(tier: 'plan' | 'fast'): string;
  request(
    req: StructuredRequest<z.ZodType>,
    repair: string | undefined,
    stream: boolean,
  ): { url: string; headers: Record<string, string>; body: unknown };
  decode(value: unknown): WireResult;
}
const LIMIT = 1_048_576;
export async function* readChunks(response: Response, signal: AbortSignal): AsyncIterable<string> {
  if (!response.body) throw new LlmError('response');
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > LIMIT) throw new LlmError('response');
      yield decoder.decode(value, { stream: true });
    }
    yield decoder.decode();
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Handles split UTF-8, CRLF, comments and multiline SSE data. */
export async function* sseData(response: Response, signal: AbortSignal): AsyncIterable<string> {
  let pending = '',
    lines: string[] = [];
  for await (const chunk of readChunks(response, signal)) {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (!line) {
        if (lines.length) yield lines.join('\n');
        lines = [];
      } else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (pending.startsWith('data:')) lines.push(pending.slice(5).replace(/^ /, '').replace(/\r$/, ''));
  if (lines.length) yield lines.join('\n');
}
export function json(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new LlmError('response');
  }
}
export function structuredProvider(wire: Wire, opts: TransportOptions = {}): LlmProvider {
  const send = opts.fetch ?? fetch,
    limits =
      typeof opts.timeoutMs === 'number'
        ? { plan: opts.timeoutMs, fast: opts.timeoutMs }
        : { plan: 120_000, fast: 30_000, ...opts.timeoutMs };
  if (Object.values(limits).some((ms) => !Number.isFinite(ms) || ms <= 0))
    throw new LlmError('configuration');
  const log = opts.log ?? ((record: CallRecord) => console.info('ai.call', record));
  async function* attempt(
    req: StructuredRequest<z.ZodType>,
    repair?: string,
    stream = false,
  ): AsyncIterable<string> {
    AiTaskName.parse(req.task);
    if (req.tier !== 'plan' && req.tier !== 'fast') throw new LlmError('configuration');
    if (
      req.temperature !== undefined &&
      (!Number.isFinite(req.temperature) || req.temperature < 0 || req.temperature > 2)
    )
      throw new LlmError('configuration');
    let input: string | undefined;
    try {
      input = JSON.stringify(req.input);
    } catch {
      throw new LlmError('configuration');
    }
    if (input === undefined || input.length > 262_144 || req.system.length > 32_768)
      throw new LlmError('configuration');
    const inputHash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const started = Date.now(),
      controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits[req.tier]);
    let text = '',
      complete = false,
      inputTokens = 0,
      outputTokens = 0,
      validationPassed = false;
    const read = (result: WireResult) => {
      if (complete && result.text) throw new LlmError('response');
      text += result.text;
      if (text.length > LIMIT) throw new LlmError('response');
      complete ||= result.complete;
      inputTokens = Math.max(inputTokens, result.inputTokens);
      outputTokens = Math.max(outputTokens, result.outputTokens);
      return result.text;
    };
    try {
      const config = wire.request(req, repair, stream);
      const response = await send(config.url, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(config.body),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new LlmError('http', response.status === 429 || response.status >= 500, response.status);
      }
      if (stream) {
        if (!response.headers.get('content-type')?.includes('text/event-stream'))
          throw new LlmError('response');
        for await (const data of sseData(response, controller.signal)) {
          if (data === '[DONE]') break;
          const chunk = read(wire.decode(json(data)));
          if (chunk) yield chunk;
        }
      } else {
        let body = '';
        for await (const chunk of readChunks(response, controller.signal)) body += chunk;
        read(wire.decode(json(body)));
      }
      if (!complete) throw new LlmError('response');
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new LlmError('validation', false, undefined, 'invalid_json');
      }
      const parsed = req.schema.safeParse(value);
      if (!parsed.success)
        throw new LlmError(
          'validation',
          false,
          undefined,
          JSON.stringify(
            parsed.error.issues
              .slice(0, 20)
              .map((issue) => ({ code: issue.code, path: issue.path.map(String) })),
          ),
        );
      validationPassed = true;
      if (!stream) yield text;
    } catch (error) {
      if (controller.signal.aborted) throw new LlmError('timeout', true);
      if (error instanceof LlmError) throw error;
      throw new LlmError('response', error instanceof TypeError);
    } finally {
      clearTimeout(timer);
      try {
        log({
          task: req.task,
          provider: wire.name,
          model: wire.model(req.tier),
          latencyMs: Date.now() - started,
          inputHash,
          inputTokens,
          outputTokens,
          validationPassed,
          repair: repair !== undefined,
        });
      } catch {
        /* Telemetry must not break generation. */
      }
    }
  }
  return {
    name: wire.name,
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.output<T>> {
      let repair: string | undefined;
      for (let retry = 0; retry < 2; retry++) {
        try {
          let text = '';
          for await (const chunk of attempt(req, repair)) text += chunk;
          return req.schema.parse(JSON.parse(text));
        } catch (error) {
          if (!(error instanceof LlmError) || error.code !== 'validation' || retry) throw error;
          repair = `Previous response failed JSON/schema validation: ${error.issues}. Return a fresh complete JSON value matching every field, type, bound and required property in the supplied schema.`;
        }
      }
      throw new LlmError('validation');
    },
    streamStructured: (req) => attempt(req, undefined, true),
  };
}
