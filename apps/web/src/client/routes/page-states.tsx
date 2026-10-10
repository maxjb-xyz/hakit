/**
 * Small building blocks shared by the Plan, Team, Code and Agents screens:
 * a page header, and the loading / error / empty states every view needs (DESIGN §9).
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { LinkKind, Task } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';

/** Page title + optional subtitle, with room for chips or buttons on the right. */
export function PageHeader(props: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-display-sm text-strong">{props.title}</h1>
        {props.subtitle && <p className="text-body text-muted">{props.subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{props.children}</div>
    </div>
  );
}

/** Tells people (and us) the screen is showing fake data, so nobody mistakes it for the real thing. */
export function MockChip() {
  return (
    <span className="inline-flex h-control-sm items-center gap-1.5 rounded-full border border-border px-2 text-label text-muted">
      <span aria-hidden className="size-1.5 rounded-full bg-ai" />
      Demo data
    </span>
  );
}

/** Grey pulsing boxes shaped roughly like the page, shown while data loads. */
export function LoadingBlocks({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('animate-pulse rounded-md border border-border bg-surface', 'h-16')} />
      ))}
    </div>
  );
}

/** What failed, reassurance that nothing is lost, and a retry button. */
export function ErrorBox(props: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-danger bg-surface px-4 py-3 text-body text-default"
    >
      <span>
        Couldn't load {props.what} ({props.error.message}). Nothing has been lost.
      </span>
      <Button size="sm" className="ml-auto" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * Stand-in for a project screen until `useProject` resolves a project: loading, error with retry, or an
 * empty state pointing at the Plan flow (where a team creates its project).
 */
export function ProjectGate(props: {
  query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown };
  title: string;
}) {
  const { wid = '' } = useParams();
  const { query } = props;
  return (
    <div className="space-y-6 p-7 max-sm:p-4">
      <PageHeader title={props.title} />
      {query.isError && query.error ? (
        <ErrorBox what="projects" error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <LoadingBlocks label="Loading project" rows={3} />
      ) : (
        <EmptyBox
          message="This workspace has no project yet. Plan one to get a board, a team view and live activity."
          action={
            <Link
              to={`/w/${wid}/plan`}
              className="inline-flex h-control-md items-center rounded-sm bg-accent-500 px-3 text-body font-medium text-strong hover:bg-accent-400"
            >
              Plan a project
            </Link>
          }
        />
      )}
    </div>
  );
}

/** One sentence explaining why the view is empty, plus an optional action. */
export function EmptyBox(props: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-strong px-6 py-10 text-center">
      <p className="text-body text-muted">{props.message}</p>
      {props.action}
    </div>
  );
}

/**
 * Which task a commit / PR / agent session belongs to. Confirmed links (e.g. from an `hk-12-…` branch name)
 * get a solid border; inferred ones (a guess) get a dashed border and the word "inferred" (DESIGN §2.5).
 */
export function TaskLinkChip(props: {
  task: Pick<Task, 'key' | 'title'> | undefined;
  linkKind: LinkKind;
  confidence?: number | null;
}) {
  const { wid = '' } = useParams();
  if (!props.task || props.linkKind === 'none') {
    return <Pill className="border-dashed text-subtle">Unlinked</Pill>;
  }
  const inferred = props.linkKind === 'inferred';
  return (
    <Link
      to={`/w/${wid}/tasks?task=${props.task.key}`}
      title={props.task.title}
      className={cn(
        'inline-flex h-control-sm shrink-0 items-center gap-1 rounded-full border px-2 text-label hover:bg-hover',
        inferred ? 'border-dashed border-border-strong text-muted' : 'border-border text-default',
      )}
    >
      <span className="font-mono">{props.task.key}</span>
      {inferred && (
        <span className="text-subtle">
          inferred{props.confidence != null && ` ${Math.round(props.confidence * 100)}%`}
        </span>
      )}
    </Link>
  );
}

/** A small rounded label, e.g. "main" or "Open". `tone` picks the text colour; always pair it with words. */
export function Pill(props: {
  children: ReactNode;
  tone?: 'muted' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  className?: string;
  title?: string;
}) {
  const tone = {
    muted: 'text-muted',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
    accent: 'text-accent-400',
  }[props.tone ?? 'muted'];
  return (
    <span
      title={props.title}
      className={cn(
        'inline-flex h-control-sm shrink-0 items-center gap-1 rounded-full border border-border px-2 text-label',
        tone,
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}
