/**
 * S6–S9 plan flow (DESIGN §8; T-302, T-304, T-307, T-311): Idea → Constraints → Plan → Assign, all through `api(...)`.
 * The step lives in `?step=`, the picked idea in `?idea=` and the reviewed plan version in `?plan=`, so every state is
 * linkable and survives a reload. Works in mock mode (HAKIT_MOCKS=1) end to end.
 */
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { qk } from '../lib/query';
import { EmptyBox, ErrorBox, LoadingBlocks, PageHeader, Pill } from './page-states';
import { AssignStep } from './plan/AssignStep';
import { ConstraintsStep } from './plan/ConstraintsStep';
import { IdeaStep } from './plan/IdeaStep';
import { PlanStep } from './plan/PlanStep';
import { Field } from './plan/ui';

const STEPS = [
  { key: 'idea', label: 'Idea', screen: 'S6' },
  { key: 'constraints', label: 'Constraints', screen: 'S7' },
  { key: 'plan', label: 'Plan', screen: 'S8' },
  { key: 'assign', label: 'Assign', screen: 'S9' },
] as const;
type Step = (typeof STEPS)[number]['key'];

export function Plan() {
  const { wid = '' } = useParams();
  const { project, query: projects } = useProject(wid);

  if (projects.isError)
    return (
      <Frame>
        <ErrorBox what="projects" error={projects.error} onRetry={() => void projects.refetch()} />
      </Frame>
    );
  if (projects.isPending)
    return (
      <Frame>
        <LoadingBlocks label="Loading project" />
      </Frame>
    );
  if (!project)
    return (
      <Frame>
        <CreateProject wid={wid} />
      </Frame>
    );
  return <PlanFlow key={project.id} wid={wid} project={project} />;
}

function Frame(props: { children: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="space-y-6 p-7 max-sm:p-4">
      <PageHeader title="Plan" subtitle={props.subtitle}>
        {props.actions}
      </PageHeader>
      {props.children}
    </div>
  );
}

function CreateProject({ wid }: { wid: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api('createProject', { params: { wid }, body: { name: name.trim() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk('listProjects', { wid }) }),
  });
  return (
    <EmptyBox
      message="No project yet. Name it to start planning; you can pick the idea next."
      action={
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Field label="Project name" value={name} onChange={setName} maxLength={80} />
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
            Create project
          </Button>
          {create.isError && (
            <p role="alert" className="basis-full text-label text-danger">
              Couldn't create the project ({create.error.message}).
            </p>
          )}
        </form>
      }
    />
  );
}

function PlanFlow({ wid, project }: { wid: string; project: Project }) {
  const pid = project.id;
  const [search, setSearch] = useSearchParams();
  const raw = search.get('step');
  const step: Step = STEPS.some((s) => s.key === raw)
    ? (raw as Step)
    : project.currentPlanId
      ? 'plan'
      : 'idea';
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSearch(next, { replace: false });
  };

  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });
  const ideas = useQuery({
    queryKey: qk('listIdeas', { pid }),
    queryFn: () => api('listIdeas', { params: { pid } }),
  });
  const ideaId = search.get('idea') ?? ideas.data?.find((i) => i.selected)?.id ?? null;
  const idea = ideas.data?.find((i) => i.id === ideaId) ?? null;
  const ms = members.data ?? [];

  const done: Record<Step, string | null> = {
    idea: idea ? idea.candidate.title : null,
    constraints: null,
    plan: project.currentPlanId ? 'Accepted' : null,
    assign: null,
  };

  return (
    <Frame
      subtitle={project.pitch ?? idea?.candidate.pitch ?? 'From idea to a plan the whole team can see.'}
      actions={
        <Pill tone={project.status === 'active' ? 'success' : 'muted'}>
          {project.name} · {project.status === 'active' ? 'Plan accepted' : project.status}
        </Pill>
      }
    >
      <Stepper step={step} done={done} onGo={(k) => go({ step: k })} />

      {members.isError && (
        <ErrorBox what="team members" error={members.error} onRetry={() => void members.refetch()} />
      )}

      <div
        key={step}
        id="plan-step-panel"
        role="tabpanel"
        aria-label={STEPS.find((s) => s.key === step)!.label}
        className="animate-fade-in"
      >
        {step === 'idea' && (
          <IdeaStep
            pid={pid}
            selectedId={ideaId}
            onPick={(id) => go({ idea: id })}
            onContinue={() => go({ step: 'constraints' })}
          />
        )}
        {step === 'constraints' && (
          <ConstraintsStep
            deadlineAt={workspace.data?.deadlineAt}
            pid={pid}
            wid={wid}
            hackathonSlug={workspace.data?.hackathonSlug}
            idea={idea}
            members={ms}
            onContinue={() => go({ step: 'plan' })}
          />
        )}
        {step === 'plan' && (
          <PlanStep
            pid={pid}
            project={project}
            idea={idea}
            planId={search.get('plan')}
            onPlanId={(id) => go({ plan: id })}
            members={ms}
            startsAt={workspace.data?.startsAt ?? null}
            onAccepted={() => go({ step: 'assign', plan: null })}
            onPickIdea={() => go({ step: 'idea' })}
          />
        )}
        {step === 'assign' && <AssignStep pid={pid} members={ms} onGoToPlan={() => go({ step: 'plan' })} />}
      </div>
    </Frame>
  );
}

/**
 * Idea → Constraints → Plan → Assign. Arrow keys move between steps (roving tabindex); the accent track under the
 * steps fills up to the current one and slides when the step changes.
 */
function Stepper(props: { step: Step; done: Record<Step, string | null>; onGo: (k: Step) => void }) {
  const current = STEPS.findIndex((s) => s.key === props.step);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = STEPS[(i + d + STEPS.length) % STEPS.length]!;
    props.onGo(next.key);
    requestAnimationFrame(() => document.getElementById(`plan-step-${next.key}`)?.focus());
  };
  return (
    <nav aria-label="Planning steps" className="space-y-2">
      <ol className="grid grid-cols-4 gap-1" role="tablist">
        {STEPS.map((s, i) => {
          const active = props.step === s.key;
          const done = props.done[s.key];
          return (
            <li key={s.key} role="presentation" className="min-w-0">
              <button
                id={`plan-step-${s.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="plan-step-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => props.onGo(s.key)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  'press flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body hover:bg-hover active:bg-pressed max-sm:justify-center max-sm:px-1',
                  active ? 'text-strong' : 'text-subtle hover:text-strong',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-caption tabular-nums transition-colors duration-(--duration-base) ease-standard',
                    active
                      ? 'border-accent-400 bg-strong text-on-light'
                      : done
                        ? 'border-success text-success'
                        : i < current
                          ? 'border-accent-400 text-accent-400'
                          : 'border-border-strong',
                  )}
                >
                  {done && !active ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate max-sm:text-label">{s.label}</span>
                  {done && (
                    <span className="block truncate text-caption text-subtle max-sm:hidden">
                      <span className="sr-only">done: </span>
                      {done}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div aria-hidden className="relative h-0.5 overflow-hidden rounded-full bg-border">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent-500 transition-[width] duration-(--duration-slow) ease-emphasized"
          style={{ width: `${((current + 1) / STEPS.length) * 100}%` }}
        />
      </div>
    </nav>
  );
}
