import { QueryClient } from '@tanstack/react-query';
import type { EndpointName } from '@hakit/contracts';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

/** Canonical query keys: [endpointName, params?]. WS events invalidate by endpoint name prefix. */
export function qk<N extends EndpointName>(
  name: N,
  params?: Record<string, string>,
): readonly [N] | readonly [N, Record<string, string>] {
  return params ? [name, params] : [name];
}
