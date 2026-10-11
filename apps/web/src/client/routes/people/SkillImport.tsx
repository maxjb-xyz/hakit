/**
 * S3 skill import: starts `importSkills`, then shows a staged checklist from `skills.import_progress` WS
 * events (real stage names, not a spinner) on the workspace room, which exists before any project does.
 * If the socket can't connect it polls `memberSkills` so results still appear.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SkillImportProgress, WsEnvelope } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { useWorkspaceSocket } from '../../lib/ws';
import { IMPORT_STEPS, countsLine, stepState, type ImportStage, type StepState } from './import-progress';

const ICON: Record<StepState, { glyph: string; cls: string; sr: string }> = {
  done: { glyph: '✓', cls: 'border-accent-500 bg-accent-500 text-strong', sr: 'done' },
  current: { glyph: '…', cls: 'border-accent-500 text-strong', sr: 'in progress' },
  pending: { glyph: '', cls: 'border-border-strong', sr: 'not started' },
  failed: { glyph: '✕', cls: 'border-danger text-danger', sr: 'failed' },
};

/** No progress for this long and the run is treated as stalled, so the button comes back. */
const STALL_MS = 90_000;

interface Run {
  jobId: string;
  /** Bumped on every event; restarts the stall timer. */
  seen: number;
  latest: SkillImportProgress | null;
  furthest: ImportStage | null;
}

export function useImportSkills(wid: string, uid: string) {
  const qc = useQueryClient();
  const [run, setRun] = useState<Run | null>(null);
  const finished = run?.latest?.stage === 'done' || run?.latest?.stage === 'error';
  // Stalled means the timer fired for the current run state; any new event changes the key and clears it.
  const runKey = run && !finished ? `${run.jobId}:${run.seen}` : null;
  const [stalledKey, setStalledKey] = useState<string | null>(null);
  const stalled = runKey !== null && stalledKey === runKey;
  useEffect(() => {
    if (!runKey) return;
    const t = setTimeout(() => setStalledKey(runKey), STALL_MS);
    return () => clearTimeout(t);
  }, [runKey]);

  const onEvent = (e: WsEnvelope) => {
    if (e.type !== 'skills.import_progress' || e.data.userId !== uid) return;
    const p = e.data.progress;
    setRun((r) => {
      const base = r ?? { jobId: 'remote', seen: 0, latest: null, furthest: null };
      const isStep = IMPORT_STEPS.some((s) => s.stage === p.stage);
      return { ...base, seen: base.seen + 1, latest: p, furthest: isStep ? p.stage : base.furthest };
    });
    if (p.stage === 'done') void qc.invalidateQueries({ queryKey: qk('teamCapability', { wid }) });
  };
  // Connected for the whole step so no early stage is missed between the POST and the first event.
  const socket = useWorkspaceSocket(wid, onEvent);

  const start = useMutation({
    mutationFn: () => api('importSkills', { params: { wid }, body: {} }),
    onSuccess: (r) => setRun({ jobId: r.jobId, seen: 0, latest: null, furthest: null }),
  });
  return { run, start, importing: !!run && !finished && !stalled, stalled, live: socket.state === 'open' };
}

export function SkillImportPanel(props: {
  importer: ReturnType<typeof useImportSkills>;
  skillCount: number;
}) {
  const { run, start, importing, stalled, live } = props.importer;
  const latest = run?.latest ?? null;
  const thin = latest?.stage === 'done' && props.skillCount < 3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-strong">Import skills from GitHub</p>
          <p className="text-label text-muted">
            Reads languages, dependencies and topics from your public repos. Nothing private, no code sent to
            AI.
          </p>
        </div>
        <Button
          variant={run ? 'secondary' : 'primary'}
          loading={start.isPending}
          disabled={importing}
          onClick={() => start.mutate()}
        >
          {run ? (importing ? 'Importing…' : 'Import again') : 'Import from GitHub'}
        </Button>
      </div>

      {start.isError && (
        <p role="alert" className="rounded-sm border border-danger px-3 py-2 text-label text-default">
          Couldn't start the import: {start.error.message}. Your existing skills are safe; try again.
        </p>
      )}

      {run && (
        <div className="rounded-sm border border-border bg-sunken p-4">
          <ol className="space-y-2" aria-live="polite">
            {IMPORT_STEPS.map((s) => {
              const st = stepState(s.stage, latest?.stage ?? null, run.furthest);
              return (
                <li key={s.stage} className="flex items-center gap-2.5 text-body">
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-full border text-caption',
                      ICON[st].cls,
                    )}
                  >
                    {ICON[st].glyph}
                  </span>
                  <span className={st === 'pending' ? 'text-subtle' : 'text-default'}>{s.label}</span>
                  <span className="sr-only">({ICON[st].sr})</span>
                  {st === 'current' && latest?.message && (
                    <span className="truncate text-label text-subtle">· {latest.message}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-label text-subtle" role="status">
            {latest?.stage === 'done'
              ? `Done. ${countsLine(latest.counts) || latest.message}`
              : latest?.stage === 'error'
                ? ''
                : latest
                  ? countsLine(latest.counts)
                  : `Queued${live ? '' : ' · live progress unavailable, checking for new skills every few seconds'}. Skills below update as they're found.`}
          </p>
          {stalled && latest?.stage !== 'error' && (
            <p role="alert" className="mt-2 text-label text-warning">
              No progress for a while, so the import may have failed. Skills found so far are kept; try again.
            </p>
          )}
          {latest?.stage === 'error' && (
            <p role="alert" className="mt-2 text-label text-danger">
              Import stopped: {latest.message}. Skills found so far are kept; you can add the rest by hand.
            </p>
          )}
        </div>
      )}

      {thin && (
        <p className="rounded-sm border border-dashed border-border-strong px-3 py-2 text-body text-muted">
          We couldn't find much public work. Add skills by hand below; you'll get learning-friendly tasks.
        </p>
      )}
    </div>
  );
}
