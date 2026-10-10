/**
 * Scaffold placeholder for each screen (DESIGN §8). Shows owner/tasks and live-fetches the screen's primary
 * endpoint to prove the wiring. Delete when the real screen lands.
 */
import { useQuery } from '@tanstack/react-query';
import type { EndpointName } from '@hakit/contracts';
import { api, type CallArgs } from '../lib/api';

export function Placeholder<N extends EndpointName>(props: {
  screen: string;
  title: string;
  tasks: string;
  endpoint?: N;
  args?: CallArgs<N>;
  summarize?: (data: unknown) => string;
}) {
  const q = useQuery({
    queryKey: [props.endpoint ?? 'none', props.args?.params ?? {}],
    queryFn: () => api(props.endpoint!, props.args),
    enabled: Boolean(props.endpoint),
  });
  return (
    <section className="mx-auto max-w-5xl p-6">
      <p className="text-caption uppercase tracking-wide text-subtle">
        {props.screen} · {props.tasks}
      </p>
      <h1 className="mt-1 font-display text-display-sm text-strong">{props.title}</h1>
      {props.endpoint && (
        <div className="mt-6 rounded-md border border-border bg-surface p-4">
          <p className="text-label text-muted">
            <code className="font-mono">{props.endpoint}</code>{' '}
            {q.isPending ? (
              'loading…'
            ) : q.isError ? (
              <span className="text-danger">{q.error.message}</span>
            ) : (
              <span className="text-success">ok</span>
            )}
          </p>
          {q.data !== undefined && (
            <>
              {props.summarize && <p className="mt-2 text-body text-default">{props.summarize(q.data)}</p>}
              <pre className="mt-3 max-h-96 overflow-auto font-mono text-caption text-subtle">
                {JSON.stringify(q.data, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}
