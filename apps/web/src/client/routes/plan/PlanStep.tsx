/**
 * S8 Plan review (T-307): generate (T-305 SSE, sections stream in), version switcher (`listPlans`), inline edits that
 * batch into one `patchPlan` on save (the server re-validates and stores a new draft version), and accept (T-308).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Idea, Member, Plan, PlanSummary, Project } from '@hakit/contracts';
import { Button } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { fmtHours } from '../mission-control/shared';
import { EmptyBox, ErrorBox, LoadingBlocks, Pill } from '../page-states';
import { applyEdits, editCount, noEdits, toPatch, type PlanEdits } from './draft';
import { PlanSections } from './PlanReview';
import { usePlanStream, type PlanStage } from './streams';
import { Field, StageProgress } from './ui';

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
          className="flex basis-full flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-3"
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

function VersionSwitcher(props: {
  versions: PlanSummary[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-label text-muted">
      Version
      <select
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-control-md rounded-sm border border-border bg-raised px-2 text-body text-default hover:bg-hover"
      >
        {props.versions.map((v) => (
          <option key={v.id} value={v.id}>
            v{v.version} · {STATUS_WORD[v.status]} · {v.taskCount} tasks · ≈{fmtHours(v.requiredHours)} of ≈
            {fmtHours(v.availableEffectiveHours)}
            {v.cutTaskCount ? ` · ${v.cutTaskCount} cut` : ''}
            {v.feasibilityOk ? '' : ' · needs fixes'}
          </option>
        ))}
      </select>
    </label>
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
          className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-md border border-border-strong bg-raised px-4 py-3 shadow-e2"
          role="region"
          aria-label="Plan actions"
        >
          {n > 0 ? (
            <span className="text-body text-default" role="status">
              {n} unsaved edit{n === 1 ? '' : 's'} · saved together as v-next and re-checked by the validator
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
