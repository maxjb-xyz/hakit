/**
 * S7 Constraints (T-302): sponsor challenge catalog, required/excluded tech, judging weights, a pinned constraints
 * panel and the deterministic fit meter against the current idea. Saved with `putConstraints`; the plan generator
 * reads the saved set, and `getConstraints` restores it when the step opens.
 */
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Challenge, HackathonTemplate, Idea, Member, PutConstraints } from '@hakit/contracts';
import { Button, TickNumber, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { clock, fmtHours, memberName } from '../mission-control/shared';
import { EmptyBox, ErrorBox, LoadingBlocks, Pill } from '../page-states';
import { constraintFit, type FitState } from './fit';
import { SectionHead, StatusMark, fieldClass, pct, stagger, useGrow, type Mark } from './ui';

/** Used when the workspace response predates `hackathonSlug` (only one template is seeded). */
export const DEFAULT_HACKATHON_SLUG = 'knight-hacks-ix';

export interface ConstraintState {
  challengeIds: string[];
  required: string[];
  excluded: string[];
  custom: string[];
  /** Judging criterion key → weight 0..1. */
  judging: Record<string, number>;
}

/** Inverse of `toPutConstraints`: the saved set back into editor state. */
export function fromPutConstraints(saved: PutConstraints): ConstraintState {
  const s: ConstraintState = { challengeIds: [], required: [], excluded: [], custom: [], judging: {} };
  for (const k of saved.constraints) {
    if (k.kind === 'challenge' && k.refId) s.challengeIds.push(k.refId);
    else if (k.kind === 'required_tech') s.required.push(k.value);
    else if (k.kind === 'excluded_tech') s.excluded.push(k.value);
    else if (k.kind === 'judging') s.judging[k.value] = k.weight;
    else if (k.kind === 'custom') s.custom.push(k.value);
  }
  return s;
}

export function toPutConstraints(s: ConstraintState, h: HackathonTemplate): PutConstraints {
  return {
    constraints: [
      ...h.challenges
        .filter((c) => s.challengeIds.includes(c.id))
        .map((c) => ({ kind: 'challenge' as const, refId: c.id, value: c.title, weight: 1 })),
      ...s.required.map((v) => ({ kind: 'required_tech' as const, refId: null, value: v, weight: 1 })),
      ...s.excluded.map((v) => ({ kind: 'excluded_tech' as const, refId: null, value: v, weight: 1 })),
      ...Object.entries(s.judging).map(([k, w]) => ({
        kind: 'judging' as const,
        refId: null,
        value: k,
        weight: w,
      })),
      ...s.custom.map((v) => ({ kind: 'custom' as const, refId: null, value: v, weight: 1 })),
    ],
  };
}

const FIT_MARK: Record<FitState, Mark> = { satisfied: 'ok', risky: 'warn', conflict: 'bad' };

export function ConstraintsStep(props: {
  pid: string;
  wid: string;
  /** From the workspace; null when it has no hackathon template, undefined while unknown. */
  hackathonSlug: string | null | undefined;
  /** The workspace's own deadline; the template's end time is only its default and may have been changed. */
  deadlineAt: string | undefined;
  idea: Idea | null;
  members: Member[];
  onContinue: () => void;
}) {
  const saved = useQuery({
    queryKey: qk('getConstraints', { pid: props.pid }),
    queryFn: () => api('getConstraints', { params: { pid: props.pid } }),
  });
  if (saved.isError)
    return <ErrorBox what="saved constraints" error={saved.error} onRetry={() => void saved.refetch()} />;
  if (saved.isPending) return <LoadingBlocks label="Loading constraints" rows={3} />;
  return <ConstraintsEditor {...props} initial={fromPutConstraints(saved.data)} />;
}

function ConstraintsEditor(props: {
  pid: string;
  wid: string;
  hackathonSlug: string | null | undefined;
  deadlineAt: string | undefined;
  idea: Idea | null;
  members: Member[];
  onContinue: () => void;
  initial: ConstraintState;
}) {
  const { pid, wid } = props;
  const qc = useQueryClient();
  const slug = props.hackathonSlug === undefined ? DEFAULT_HACKATHON_SLUG : props.hackathonSlug;
  const hackathon = useQuery({
    queryKey: qk('getHackathon', { slug: slug ?? '' }),
    queryFn: () => api('getHackathon', { params: { slug: slug! } }),
    enabled: !!slug,
  });
  const cap = useQuery({
    queryKey: qk('teamCapability', { wid }),
    queryFn: () => api('teamCapability', { params: { wid } }),
  });
  const [state, setState] = useState<ConstraintState>(props.initial);
  const [dirty, setDirty] = useState(false);
  const update = (patch: Partial<ConstraintState>) => {
    setState((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: (h: HackathonTemplate) =>
      api('putConstraints', { params: { pid }, body: toPutConstraints(state, h) }),
    onSuccess: (data) => {
      setDirty(false);
      qc.setQueryData(qk('getConstraints', { pid }), data);
    },
  });

  if (slug === null)
    return (
      <EmptyBox message="This workspace isn't linked to a hackathon, so there are no sponsor challenges to pick. Set one in Settings, or continue without constraints." />
    );

  if (hackathon.isError)
    return (
      <ErrorBox
        what="the hackathon catalog"
        error={hackathon.error}
        onRetry={() => void hackathon.refetch()}
      />
    );
  if (hackathon.isPending) return <LoadingBlocks label="Loading sponsor challenges" rows={3} />;
  const h = hackathon.data;

  const chosen = h.challenges.filter((c) => state.challengeIds.includes(c.id));
  const requiredTech = [...chosen.flatMap((c) => c.requiredTech), ...state.required];
  const fit = constraintFit({
    requiredTech,
    excludedTech: state.excluded,
    ideaStack: props.idea?.candidate.stack.flatMap((s) => s.skillSlugs) ?? [],
    members: props.members,
  });
  const nameOf = (id: string) => memberName(props.members.find((m) => m.user.id === id));

  return (
    <div className="grid gap-6 lg:grid-cols-(--grid-side-360)">
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="challenges-h" className="space-y-3">
          <SectionHead id="challenges-h" title="Sponsor challenges" meta={h.name} />
          {h.challenges.length === 0 ? (
            <EmptyBox message="This hackathon has no sponsor challenges listed yet." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {h.challenges.map((c) => (
                <ChallengeCard
                  key={c.id}
                  challenge={c}
                  selected={state.challengeIds.includes(c.id)}
                  onToggle={() =>
                    update({
                      challengeIds: state.challengeIds.includes(c.id)
                        ? state.challengeIds.filter((x) => x !== c.id)
                        : [...state.challengeIds, c.id],
                    })
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="tech-h" className="grid gap-4 md:grid-cols-2">
          <h2 id="tech-h" className="sr-only">
            Technology
          </h2>
          <TagInput
            label="Required tech"
            items={state.required}
            onChange={(required) => update({ required })}
            placeholder="e.g. cloudflare-workers"
          />
          <TagInput
            label="Excluded tech"
            items={state.excluded}
            onChange={(excluded) => update({ excluded })}
            placeholder="e.g. firebase"
          />
          <TagInput
            label="Other constraints"
            items={state.custom}
            onChange={(custom) => update({ custom })}
            placeholder="e.g. must run offline"
            className="md:col-span-2"
          />
        </section>

        {h.judgingCriteria.length > 0 && (
          <section aria-labelledby="judging-h" className="space-y-2">
            <SectionHead
              id="judging-h"
              title="Judging weights"
              meta="How much each criterion matters to you"
            />
            <ul className="space-y-2 rounded-md border border-border bg-surface p-4">
              {h.judgingCriteria.map((j) => {
                const w = state.judging[j.key] ?? j.weight ?? 1;
                return (
                  <li key={j.key} className="flex flex-wrap items-center gap-3">
                    <label htmlFor={`judging-${j.key}`} className="min-w-0 flex-1 text-body text-default">
                      {j.name}
                    </label>
                    <input
                      id={`judging-${j.key}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.25}
                      value={w}
                      onChange={(e) =>
                        update({ judging: { ...state.judging, [j.key]: Number(e.target.value) } })
                      }
                      className="w-40 accent-accent-500"
                    />
                    <span className="w-10 text-right text-label text-muted">{pct(w)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Pinned constraints">
        <section className="space-y-3 rounded-md border border-border bg-surface p-4">
          <SectionHead title="Constraints">
            {dirty ? (
              <span className="flex items-center gap-1 text-label text-warning">
                <span aria-hidden>●</span> Unsaved
              </span>
            ) : save.isSuccess ? (
              <span role="status" className="flex animate-pop-in items-center gap-1 text-label text-success">
                <span aria-hidden>✓</span> Saved
              </span>
            ) : null}
          </SectionHead>
          <dl className="grid grid-cols-2 gap-2 text-label">
            <div>
              <dt className="text-subtle">Deadline</dt>
              <dd className="text-default">{props.deadlineAt ? clock(props.deadlineAt) : '…'}</dd>
            </div>
            <div>
              <dt className="text-subtle">Team hours</dt>
              <dd className="text-default" title="Estimated: available hours × focus factor">
                {cap.data ? `≈ ${fmtHours(cap.data.totalEffectiveHours)}` : cap.isError ? 'Unknown' : '…'}{' '}
                <span className="text-subtle">estimated</span>
              </dd>
            </div>
          </dl>
          {chosen.length + state.required.length + state.excluded.length + state.custom.length === 0 ? (
            <p className="text-body text-subtle">Nothing pinned yet. Pick a challenge or add tech.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <li key={c.id} className="animate-pop-in">
                  <Pill tone="accent">{c.sponsor}</Pill>
                </li>
              ))}
              {state.required.map((t) => (
                <li key={`r-${t}`} className="animate-pop-in">
                  <Pill>needs {t}</Pill>
                </li>
              ))}
              {state.excluded.map((t) => (
                <li key={`x-${t}`} className="animate-pop-in">
                  <Pill tone="danger">no {t}</Pill>
                </li>
              ))}
              {state.custom.map((t) => (
                <li key={`c-${t}`} className="animate-pop-in">
                  <Pill>{t}</Pill>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-md border border-border bg-surface p-4" aria-labelledby="fit-h">
          <SectionHead
            id="fit-h"
            title="Constraint fit"
            meta={fit.items.length ? `${fit.satisfied}/${fit.items.length} satisfied` : undefined}
          />
          <p className="text-caption text-subtle">
            {props.idea
              ? `Against “${props.idea.candidate.title}”. `
              : 'Pick an idea to also check its stack. '}
            Deterministic: compares required tech with the team's skills.
          </p>
          {fit.items.length === 0 ? (
            <p className="text-body text-subtle">No required tech yet, so nothing can conflict.</p>
          ) : (
            <>
              <FitBar score={fit.score} />
              <ul className="space-y-1.5">
                {fit.items.map((i, n) => (
                  <li
                    key={`${i.tech}-${i.state}`}
                    style={stagger(n)}
                    className="flex animate-list-in flex-wrap items-center gap-x-2 gap-y-0.5 text-label"
                  >
                    <StatusMark mark={FIT_MARK[i.state]} hideWord />
                    <span className="font-mono text-default">{i.tech}</span>
                    <span className="text-subtle">
                      {i.state === 'satisfied' ? 'Satisfied' : i.state === 'risky' ? 'Risky' : 'Conflict'} ·{' '}
                      {i.reason}
                      {i.userIds.length > 0 && i.state === 'satisfied' && ` (${nameOf(i.userIds[0]!)})`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button loading={save.isPending} onClick={() => save.mutate(h)} disabled={!dirty}>
            Save constraints
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() =>
              dirty ? save.mutate(h, { onSuccess: () => props.onContinue() }) : props.onContinue()
            }
          >
            Continue to plan
          </Button>
          {save.isError && (
            <p role="alert" className="basis-full text-label text-danger">
              Couldn't save ({save.error.message}). Your selection is kept here; try again.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Coverage share is counted, not estimated: solid bar (DESIGN §2.5); the number is always shown beside it. */
function FitBar({ score }: { score: number }) {
  const w = useGrow(score);
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={`Constraint fit ${pct(score)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(score * 100)}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-(--duration-slow) ease-emphasized',
            score >= 0.8 ? 'bg-success' : score >= 0.5 ? 'bg-warning' : 'bg-danger',
          )}
          style={{ width: `${w * 100}%` }}
        />
      </div>
      <TickNumber value={pct(score)} className="w-10 justify-end text-label text-strong" />
    </div>
  );
}

function ChallengeCard(props: { challenge: Challenge; selected: boolean; onToggle: () => void }) {
  const c = props.challenge;
  return (
    <li>
      <button
        type="button"
        aria-pressed={props.selected}
        onClick={props.onToggle}
        className={cn(
          'hover-light press flex h-full w-full flex-col gap-2 rounded-md border p-4 text-left transition-[border-color,background-color,box-shadow] duration-(--duration-base) ease-standard',
          props.selected
            ? 'border-accent-400 bg-raised shadow-[0_0_0_3px_var(--color-accent-a12)]'
            : 'border-border bg-surface hover:border-border-strong',
        )}
      >
        <span className="flex w-full items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-caption uppercase tracking-wide text-subtle">{c.sponsor}</span>
            <span className="block text-body font-medium text-strong">{c.title}</span>
          </span>
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full border px-2 text-label transition-colors duration-(--duration-fast)',
              props.selected ? 'border-accent-400 text-accent-400' : 'border-border text-subtle',
            )}
          >
            <span aria-hidden key={String(props.selected)} className="animate-pop-in">
              {props.selected ? '✓' : '+'}
            </span>
            {props.selected ? 'Selected' : 'Select'}
          </span>
        </span>
        {c.requirements.length > 0 && (
          <span className="block space-y-0.5 text-label text-default">
            {c.requirements.map((r) => (
              <span key={r} className="block">
                {r}
              </span>
            ))}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          {c.requiredTech.map((t) => (
            <Pill key={t} className="font-mono">
              {t}
            </Pill>
          ))}
          {c.prize && <Pill tone="success">{c.prize}</Pill>}
          {!c.verified && <Pill className="border-dashed text-subtle">Unverified</Pill>}
        </span>
      </button>
    </li>
  );
}

function TagInput(props: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (v && !props.items.includes(v)) props.onChange([...props.items, v]);
    setText('');
  };
  return (
    <div className={cn('space-y-1.5', props.className)}>
      <label htmlFor={id} className="block text-label text-muted">
        {props.label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={text}
          placeholder={props.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className={cn(fieldClass, 'h-control-lg py-0')}
        />
        <Button onClick={add} disabled={!text.trim()}>
          Add
        </Button>
      </div>
      {props.items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {props.items.map((t) => (
            <li key={t} className="animate-pop-in">
              <button
                type="button"
                onClick={() => props.onChange(props.items.filter((x) => x !== t))}
                aria-label={`Remove ${t}`}
                className="interactive press inline-flex h-control-sm items-center gap-1.5 rounded-full border border-border bg-raised pr-1.5 pl-2.5 text-label text-default"
              >
                <span className="font-mono">{t}</span>
                <span aria-hidden className="grid size-4 place-items-center rounded-full text-subtle">
                  ×
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
