/**
 * S8 Plan review (T-307): generate (T-305 SSE, sections stream in), version switcher (`listPlans`), inline edits that
 * batch into one `patchPlan` on save (the server re-validates and stores a new draft version), and accept (T-308).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Idea, Member, Plan, PlanSummary, Project } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { fmtHours } from '../mission-control/shared';
import { EmptyBox, ErrorBox, LoadingBlocks, Pill } from '../page-states';
import { applyEdits, editCount, noEdits, toPatch, type PlanEdits } from './draft';
import { PlanSections } from './PlanReview';
import { usePlanStream, type PlanStage } from './streams';
import { Field, StageProgress, StatusMark } from './ui';

const STAGE_LABEL: Record<PlanStage, string> = {
  context: 'Reading team capability and the idea',
  outline: 'Drafting scope and architecture',
  tasks: 'Breaking epics into tasks',
  validate: 'Checking capacity, skills and dependencies',
  repair: 'Repairing issues the validator found',
  save: 'Saving a new draft version',
};

const STATUS_WORD = { draft: 'Draft', accepted: 'Accepted', superseded: 'Superseded' } as const;

export function PlanStep(props: {
  pid: string;
  project: Project;
  idea: Idea | null;
  planId: string | null;
  onPlanId: (id: string) => void;
  members: Member[];
  startsAt: string | null;
  onAccepted: () => void;
  onPickIdea: () => void;
}) {
  const { pid } = props;
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: qk('listPlans', { pid }),
    queryFn: () => api('listPlans', { params: { pid } }),
  });
  // Default to the newest version (what you'd review next); the accepted one if versions can't load.
  const currentId =
    props.planId ?? versions.data?.[0]?.id ?? (versions.isError ? props.project.currentPlanId : null);
  const plan = useQuery({
    queryKey: qk('getPlan', { pid, planId: currentId ?? '' }),
    queryFn: () => api('getPlan', { params: { pid, planId: currentId! } }),
    enabled: !!currentId,
  });
  const gen = usePlanStream((s) => {
    void qc.invalidateQueries({ queryKey: qk('listPlans', { pid }) });
    if (s.planId) props.onPlanId(s.planId);
  });
  const [guidance, setGuidance] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);

  const generate = (g?: string) => {
    if (!props.idea) return;
    void gen.start('generatePlan', {
      params: { pid },
      body: { ideaId: props.idea.id, guidance: g?.trim() || undefined },
    });
  };

  const streaming = gen.state.running || (!!gen.state.error && !gen.state.planId);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {versions.data && versions.data.length > 0 && (
        <VersionSwitcher
          versions={versions.data}
          value={currentId}
          onChange={(id) => {
            gen.reset();
            props.onPlanId(id);
          }}
        />
      )}
      {versions.isError && (
        <span className="text-label text-danger" role="alert">
          Couldn't load versions.{' '}
          <Button size="sm" variant="ghost" onClick={() => void versions.refetch()}>
            Retry
          </Button>
        </span>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {props.idea ? (
          <span className="text-label text-subtle">
            Idea: <span className="text-default">{props.idea.candidate.title}</span>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={props.onPickIdea}>
            Pick an idea first
          </Button>
        )}
        <Button
          size="sm"
          aria-expanded={showGuidance}
          disabled={!props.idea || gen.state.running}
          onClick={() => setShowGuidance((v) => !v)}
        >
          Regenerate with instruction
        </Button>
        <Button
          size="sm"
          variant={versions.data?.length ? 'secondary' : 'primary'}
          disabled={!props.idea}
          loading={gen.state.running}
          onClick={() => generate()}
        >
          {versions.data?.length ? 'Generate new version' : 'Generate plan'}
        </Button>
      </span>
      {showGuidance && (
        <form
          className="flex basis-full animate-slide-up flex-wrap items-end gap-2 rounded-md border border-border border-l-2 border-l-ai bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            generate(guidance);
            setShowGuidance(false);
          }}
        >
          <Field
            className="min-w-0 flex-1"
            label="Instruction"
            value={guidance}
            onChange={setGuidance}
            maxLength={1000}
            placeholder="e.g. Simpler architecture, cut the mobile app, more time for the demo"
            hint="Regenerates the whole plan as a new draft version; your current versions stay in the switcher."
          />
          <Button type="submit" variant="primary" disabled={!guidance.trim()}>
            Regenerate
          </Button>
        </form>
      )}
    </div>
  );

  let body;
  if (streaming) {
    const tasks = Object.values(gen.state.tasksByEpic).flat();
    body = (
      <div className="space-y-4">
        <StageProgress
          title="Generating plan"
          stages={gen.state.stages.map((s) => s.message || STAGE_LABEL[s.stage])}
          running={gen.state.running}
          onCancel={gen.cancel}
        />
        {gen.state.error && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-danger bg-surface px-4 py-3 text-body"
          >
            <p className="text-default">
              Plan generation stopped: {gen.state.error.message}. No partial plan was saved; existing versions
              are safe.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => generate()}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={gen.reset}>
                Back to saved versions
              </Button>
            </div>
          </div>
        )}
        <PlanSections
          outline={gen.state.outline}
          tasks={tasks}
          feasibility={gen.state.feasibility}
          members={props.members}
          startsAt={props.startsAt}
          streaming={gen.state.running}
        />
      </div>
    );
  } else if (!currentId) {
    body = versions.isPending ? (
      <LoadingBlocks label="Loading plan versions" />
    ) : (
      <EmptyBox
        message={
          props.idea
            ? `No plan yet. Generate one for “${props.idea.candidate.title}”; it streams in section by section.`
            : 'No plan yet. Pick an idea first, then generate a plan.'
        }
        action={
          props.idea ? (
            <Button variant="primary" onClick={() => generate()}>
              Generate plan
            </Button>
          ) : (
            <Button variant="primary" onClick={props.onPickIdea}>
              Pick an idea
            </Button>
          )
        }
      />
    );
  } else if (plan.isError) {
    body = <ErrorBox what="the plan" error={plan.error} onRetry={() => void plan.refetch()} />;
  } else if (plan.isPending) {
    body = <LoadingBlocks label="Loading plan" rows={5} />;
  } else {
    body = (
      <SavedPlan
        key={plan.data.id}
        pid={pid}
        plan={plan.data}
        members={props.members}
        startsAt={props.startsAt}
        onSaved={props.onPlanId}
        onAccepted={props.onAccepted}
      />
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {body}
    </div>
  );
}

/**
 * Version switcher: a button that opens a listbox popover of every version with its status, size and feasibility.
 * Arrow keys move, Enter/Space picks, Escape closes and returns focus to the button.
 */
function VersionSwitcher(props: {
  versions: PlanSummary[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = props.versions.find((v) => v.id === props.value) ?? props.versions[0]!;
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const show = () => {
    setActive(Math.max(0, props.versions.indexOf(current)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const pick = (v: PlanSummary) => {
    if (v.id !== props.value) props.onChange(v.id);
    close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = props.versions.length;
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % n);
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(props.versions[active]!);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.stopPropagation();
      close();
      return;
    } else return;
    e.preventDefault();
  };
  return (
    <div className="relative min-w-0">
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Plan version: v${current.version}, ${STATUS_WORD[current.status]}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
        className="field press flex h-control-md max-w-full min-w-0 items-center gap-2 rounded-sm px-2.5 text-body"
      >
        <span className="text-label text-subtle">Version</span>
        <span className="font-medium text-strong">v{current.version}</span>
        <VersionStatus v={current} />
        <span
          aria-hidden
          className={cn('text-subtle transition-transform duration-(--duration-fast)', open && 'rotate-180')}
        >
          ▾
        </span>
      </button>
      {open && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          tabIndex={-1}
          aria-label="Plan versions"
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onKey}
          className="absolute top-full left-0 z-20 mt-1 max-h-80 w-max max-w-[min(26rem,calc(100vw-2rem))] origin-top-left animate-pop-in overflow-auto rounded-md border border-border-strong bg-raised p-1 shadow-e2 outline-none"
        >
          {props.versions.map((v, i) => {
            const selected = v.id === current.id;
            return (
              <li
                key={v.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(v)}
                className={cn(
                  'flex items-start gap-3 rounded-sm px-2.5 py-2',
                  i === active && 'bg-hover',
                  'active:bg-pressed',
                )}
              >
                <span
                  aria-hidden
                  className={cn('w-3 pt-0.5 text-label', selected ? 'text-accent-400' : 'text-transparent')}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex items-center gap-2">
                    <span className="text-body font-medium text-strong">v{v.version}</span>
                    <VersionStatus v={v} />
                  </span>
                  <span className="block text-label text-subtle">
                    {v.taskCount} tasks · ≈{fmtHours(v.requiredHours)} of ≈
                    {fmtHours(v.availableEffectiveHours)} <span className="text-faint">estimated</span>
                    {v.cutTaskCount ? ` · ${v.cutTaskCount} cut` : ''}
                  </span>
                </span>
                <span className="pt-0.5">
                  <StatusMark
                    mark={v.feasibilityOk ? 'ok' : 'warn'}
                    word={v.feasibilityOk ? 'Feasible' : 'Needs fixes'}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VersionStatus({ v }: { v: PlanSummary }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 text-caption',
        v.status === 'accepted'
          ? 'border-success text-success'
          : v.status === 'draft'
            ? 'border-border-strong text-muted'
            : 'border-border text-faint',
      )}
    >
      {STATUS_WORD[v.status]}
    </span>
  );
}

function SavedPlan(props: {
  pid: string;
  plan: Plan;
  members: Member[];
  startsAt: string | null;
  onSaved: (id: string) => void;
  onAccepted: () => void;
}) {
  const { pid, plan } = props;
  const qc = useQueryClient();
  const [edits, setEdits] = useState<PlanEdits>(noEdits);
  // Only drafts are editable. The server also refuses edits once another version is accepted (409); that message
  // is shown as-is rather than guessed here.
  const editable = plan.status === 'draft';
  const view = applyEdits(plan.payload, edits);
  const n = editCount(edits);

  const save = useMutation({
    mutationFn: () =>
      api('patchPlan', { params: { pid, planId: plan.id }, body: toPatch(plan.payload, edits) }),
    onSuccess: (saved) => {
      setEdits(noEdits());
      qc.setQueryData(qk('getPlan', { pid, planId: saved.id }), saved);
      void qc.invalidateQueries({ queryKey: qk('listPlans', { pid }) });
      props.onSaved(saved.id);
    },
  });
  const accept = useMutation({
    mutationFn: () => api('acceptPlan', { params: { pid, planId: plan.id }, body: {} }),
    onSuccess: (board) => {
      qc.setQueryData(qk('getBoard', { pid }), board);
      void qc.invalidateQueries({ queryKey: qk('listPlans', { pid }) });
      void qc.invalidateQueries({ queryKey: ['listProjects'] });
      void qc.invalidateQueries({ queryKey: ['getProject'] });
      props.onAccepted();
    },
  });
  const blocking = plan.feasibility.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={plan.status === 'accepted' ? 'success' : 'muted'}>
          <span aria-hidden>{plan.status === 'accepted' ? '✓' : '○'}</span>v{plan.version} ·{' '}
          {STATUS_WORD[plan.status]}
        </Pill>
        <span className="text-label text-subtle">
          {new Date(plan.createdAt).toLocaleString([], {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · model {plan.model}
        </span>
        {plan.status !== 'draft' && (
          <span className="text-label text-subtle">Read-only: only drafts can be edited.</span>
        )}
      </div>

      <PlanSections
        outline={view.outline}
        tasks={view.tasks}
        feasibility={plan.feasibility}
        members={props.members}
        startsAt={props.startsAt}
        edit={editable ? { edits, set: (fn) => setEdits(fn) } : undefined}
      />

      {editable && (
        <div
          className="sticky bottom-0 z-10 -mx-1 flex animate-slide-up flex-wrap items-center gap-2 rounded-md border border-border-strong bg-raised px-4 py-3 shadow-e2"
          role="region"
          aria-label="Plan actions"
        >
          {n > 0 ? (
            <span className="flex items-center gap-2 text-body text-default" role="status">
              <span
                key={n}
                aria-hidden
                className="grid h-5 min-w-5 animate-pop-in place-items-center rounded-full bg-accent-500 px-1 text-caption text-strong tabular-nums"
              >
                {n}
              </span>
              unsaved edit{n === 1 ? '' : 's'} · saved together as v-next and re-checked by the validator
            </span>
          ) : (
            <span className="text-body text-subtle">
              Edit any section, then save.{' '}
              {blocking > 0 && `${blocking} blocking issue${blocking === 1 ? '' : 's'} to fix.`}
            </span>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            {n > 0 && (
              <>
                <Button variant="ghost" onClick={() => setEdits(noEdits())} disabled={save.isPending}>
                  Discard
                </Button>
                <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                  Save as new version
                </Button>
              </>
            )}
            {n === 0 && (
              <Button
                variant="primary"
                loading={accept.isPending}
                disabled={blocking > 0}
                title={blocking ? 'Fix blocking issues first' : undefined}
                onClick={() => accept.mutate()}
              >
                Accept plan v{plan.version}
              </Button>
            )}
          </span>
          {(save.isError || accept.isError) && (
            <p role="alert" className="basis-full text-label text-danger">
              {save.isError
                ? `Couldn't save (${save.error.message}). Your edits are still here.`
                : `Couldn't accept (${accept.error!.message}). Nothing was created.`}
            </p>
          )}
        </div>
      )}
      {plan.status === 'accepted' && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={props.onAccepted}>
            Review assignments
          </Button>
        </div>
      )}
    </div>
  );
}
