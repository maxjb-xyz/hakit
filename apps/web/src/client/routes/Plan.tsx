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
      <nav aria-label="Planning steps">
        <ol className="flex flex-wrap gap-1 border-b border-border" role="tablist">
          {STEPS.map((s, i) => (
            <li key={s.key} role="presentation">
              <button
                type="button"
                role="tab"
                aria-selected={step === s.key}
                aria-controls="plan-step-panel"
                onClick={() => go({ step: s.key })}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-body transition-colors duration-(--duration-instant)',
                  step === s.key
                    ? 'border-accent-500 text-strong'
                    : 'border-transparent text-subtle hover:text-strong',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-5 place-items-center rounded-full border text-caption',
                    done[s.key] ? 'border-success text-success' : 'border-border-strong',
                  )}
                >
                  {done[s.key] ? '✓' : i + 1}
                </span>
                {s.label}
                {done[s.key] && (
                  <span className="max-w-40 truncate text-label text-subtle max-sm:hidden">
                    <span className="sr-only">done: </span>
                    {done[s.key]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {members.isError && (
        <ErrorBox what="team members" error={members.error} onRetry={() => void members.refetch()} />
      )}

      <div id="plan-step-panel" role="tabpanel" aria-label={STEPS.find((s) => s.key === step)!.label}>
        {step === 'idea' && <IdeaStep pid={pid} selectedId={ideaId} onPick={(id) => go({ idea: id })} />}
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
