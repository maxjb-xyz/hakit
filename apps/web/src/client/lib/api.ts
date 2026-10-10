/**
 * Typed API client generated from @hakit/contracts `endpoints`. Never hand-write fetch calls to /api.
 *   const ws = await api('getWorkspace', { params: { wid } });
 */
import {
  API_PREFIX,
  buildPath,
  endpoints,
  type ApiError,
  type EndpointBody,
  type EndpointName,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResponse,
} from '@hakit/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError['error'],
  ) {
    super(body.message);
  }
}

type Opt<K extends string, T> = [T] extends [undefined]
  ? { [P in K]?: never }
  : keyof T extends never
    ? { [P in K]?: T }
    : { [P in K]: T };
export type CallArgs<N extends EndpointName> = Opt<'params', EndpointParams<N>> &
  Opt<'body', EndpointBody<N>> &
  Opt<'query', EndpointQuery<N>> & { signal?: AbortSignal };

function url<N extends EndpointName>(name: N, args: { params?: unknown; query?: unknown }) {
  const def = endpoints[name];
  let u = API_PREFIX + buildPath(def.path, (args.params ?? {}) as Record<string, string>);
  if (args.query) {
    const qs = new URLSearchParams(
      Object.entries(args.query as Record<string, unknown>)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    );
    if ([...qs].length) u += `?${qs}`;
  }
  return u;
}

export async function api<N extends EndpointName>(
  name: N,
  args: CallArgs<N> = {} as CallArgs<N>,
): Promise<EndpointResponse<N>> {
  const def = endpoints[name];
  const res = await fetch(url(name, args), {
    method: def.method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'hakit' },
    body:
      'body' in def && args.body !== undefined
        ? JSON.stringify(args.body)
        : def.method === 'GET'
          ? undefined
          : '{}',
    signal: args.signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      (json as ApiError | null)?.error ?? { code: 'http_error', message: res.statusText },
    );
  }
  return json as EndpointResponse<N>;
}

/**
 * POST an SSE endpoint and yield parsed events (PlanStreamEvent / IdeaStreamEvent).
 *   for await (const ev of stream<PlanStreamEvent>('generatePlan', { params: { pid }, body: { ideaId } })) …
 */
export async function* stream<E>(
  name: EndpointName,
  args: { params?: Record<string, string>; body?: unknown; signal?: AbortSignal },
): AsyncGenerator<E> {
  const def = endpoints[name];
  const res = await fetch(url(name, args), {
    method: def.method,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-requested-with': 'hakit' },
    body: JSON.stringify(args.body ?? {}),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, json?.error ?? { code: 'http_error', message: res.statusText });
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as E;
    }
  }
}
