import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import {
  endpoints,
  type EndpointBody,
  type EndpointName,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResponse,
} from '@hakit/contracts';
import type { AppEnv } from './context';
import { HttpError } from './errors';
import { authorizePath } from '../middleware/auth';

export interface HandlerArgs<N extends EndpointName> {
  c: Context<AppEnv>;
  params: EndpointParams<N>;
  body: EndpointBody<N> extends undefined
    ? undefined
    : z.output<NonNullable<(typeof endpoints)[N] extends { body: infer B } ? B : never>>;
  query: EndpointQuery<N> extends undefined
    ? undefined
    : z.output<NonNullable<(typeof endpoints)[N] extends { query: infer Q } ? Q : never>>;
}

type Def = { method: string; path: string; body?: z.ZodType; query?: z.ZodType; response?: z.ZodType };

async function parseInput(c: Context<AppEnv>, def: Def) {
  let body: unknown = undefined;
  if (def.body) {
    const raw = await c.req.json().catch(() => ({}));
    const r = def.body.safeParse(raw);
    if (!r.success)
      throw new HttpError(400, 'invalid_body', 'Request body failed validation', r.error.issues);
    body = r.data;
  }
  let query: unknown = undefined;
  if (def.query) {
    const r = def.query.safeParse(c.req.query());
    if (!r.success) throw new HttpError(400, 'invalid_query', 'Query failed validation', r.error.issues);
    query = r.data;
  }
  return { body, query, params: c.req.param() };
}

/**
 * Register a JSON endpoint declared in @hakit/contracts `endpoints`.
 * Validates body/query in, and (in mock/dev) the response out — contract drift fails loudly.
 */
export function route<N extends EndpointName>(
  app: Hono<AppEnv>,
  name: N,
  handler: (args: HandlerArgs<N>) => Promise<EndpointResponse<N>> | EndpointResponse<N>,
) {
  const def = endpoints[name] as Def;
  app.on(def.method, def.path, async (c) => {
    await authorizePath(c, def.path, c.req.param());
    const input = await parseInput(c, def);
    const result = await handler({ c, ...input } as unknown as HandlerArgs<N>);
    if (def.response && c.var.mocks) {
      const r = def.response.safeParse(result);
      if (!r.success)
        throw new HttpError(
          500,
          'contract_violation',
          `Response for ${String(name)} violates contract`,
          r.error.issues,
        );
    }
    return c.json(result as object);
  });
}

/** Register an SSE endpoint. `send` validates nothing; emit contract event objects (e.g. PlanStreamEvent). */
export function sseRoute<N extends EndpointName>(
  app: Hono<AppEnv>,
  name: N,
  handler: (
    args: HandlerArgs<N> & { send: (event: { type: string } & Record<string, unknown>) => Promise<void> },
  ) => Promise<void>,
) {
  const def = endpoints[name] as Def;
  app.on(def.method, def.path, async (c) => {
    await authorizePath(c, def.path, c.req.param());
    const input = await parseInput(c, def);
    // The Response returns before the stream body runs; tell the request middleware when it actually ends.
    let finished!: () => void;
    c.set('streamDone', new Promise<void>((resolve) => (finished = resolve)));
    return streamSSE(c, async (stream) => {
      const send = (event: { type: string } & Record<string, unknown>) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      try {
        await handler({ c, ...input, send } as unknown as HandlerArgs<N> & { send: typeof send });
      } finally {
        finished();
      }
    });
  });
}
