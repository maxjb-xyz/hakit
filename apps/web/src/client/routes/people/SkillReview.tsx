/**
 * Review and edit a member's skills (S3 results, S4 Skills tab). Grouped by category; each skill shows its
 * level, whether it's confirmed or inferred (dashed + AI glyph + confidence), and an evidence expander.
 * Edits go through `upsertSkill` / `removeSkill`, which only ever act on the signed-in member.
 */
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Evidence, EvidenceKind, MemberSkill, Skill, SkillCategory } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { AiGlyph } from '../mission-control/RecommendationList';
import { CATEGORY_LABEL, useInvalidateMember } from './shared';

const LEVEL_WORD = ['', 'Beginner', 'Familiar', 'Comfortable', 'Strong', 'Expert'];
const LEVEL_BG = ['', 'bg-level-1', 'bg-level-2', 'bg-level-3', 'bg-level-4', 'bg-level-5'];

const EVIDENCE_KIND: Record<EvidenceKind, string> = {
  repo_language: 'Repo language',
  manifest_dependency: 'Dependency',
  repo_topic: 'Repo topic',
  readme_semantic: 'README',
  contribution: 'Contribution',
  self_report: 'Self-reported',
  completed_task: 'Completed task',
};

export const isInferred = (s: MemberSkill) => s.source === 'inferred' && !s.confirmedAt;

/** How a skill got onto the profile, in words. */
export function sourceLabel(s: MemberSkill) {
  if (isInferred(s)) return `Inferred · ${Math.round(s.confidence * 100)}% confidence`;
  if (s.source === 'self_added') return 'Added by member';
  if (s.source === 'task_history') return 'From completed tasks';
  return 'Confirmed';
}

/** Five-step meter; the level is also written out so it never relies on shade alone. */
export function LevelMeter({ level, inferred }: { level: number; inferred: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((l) => (
        <span
          key={l}
          className={cn(
            'h-2 w-3 rounded-xs',
            l <= level
              ? inferred
                ? 'border border-dashed border-level-5 bg-transparent'
                : LEVEL_BG[Math.max(3, level)]
              : 'bg-level-1',
          )}
        />
      ))}
    </span>
  );
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0)
    return <p className="text-label text-subtle">No evidence recorded; the member added this themselves.</p>;
  return (
    <ul className="space-y-1.5">
      {evidence.map((e) => (
        <li key={e.id} className="text-label">
          <span className="text-default">{e.summary}</span>
          <span className="text-subtle">
            {' · '}
            {EVIDENCE_KIND[e.kind]}
            {' · '}
            {e.url ? (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-xs font-mono underline decoration-border-strong underline-offset-2 hover:text-strong"
              >
                {e.sourceRef}
              </a>
            ) : (
              <span className="font-mono">{e.sourceRef}</span>
            )}
            {' · '}
            {new Date(e.observedAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SkillRow(props: { wid: string; uid: string; skill: MemberSkill; editable: boolean }) {
  const s = props.skill;
  const inferred = isInferred(s);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const invalidate = useInvalidateMember();
  const save = useMutation({
    mutationFn: (level: number) =>
      api('upsertSkill', { params: { slug: s.skill.slug }, body: { level, confirmed: true } }),
    onSuccess: () => invalidate(props.wid, props.uid),
  });
  const remove = useMutation({
    mutationFn: () => api('removeSkill', { params: { slug: s.skill.slug } }),
    onSuccess: () => invalidate(props.wid, props.uid),
  });
  const busy = save.isPending || remove.isPending;

  return (
    <li
      className={cn(
        'animate-fade-in rounded-sm border px-3 py-2.5 transition-colors duration-(--duration-fast) ease-standard',
        inferred ? 'border-dashed border-border-strong' : 'border-border bg-surface',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:basis-full">
          {inferred && <AiGlyph />}
          <span className="truncate text-body font-medium text-strong">{s.skill.name}</span>
          <LevelMeter level={s.level} inferred={inferred} />
          <span className="whitespace-nowrap text-label text-muted">
            {s.level} · {LEVEL_WORD[s.level]}
          </span>
        </div>
        <span
          key={String(inferred)}
          className={cn(
            'inline-flex animate-pop-in items-center gap-1 rounded-full border px-2 text-label',
            inferred ? 'border-dashed border-border-strong text-muted' : 'border-success text-success',
          )}
        >
          <span aria-hidden>{inferred ? '?' : '✓'}</span>
          {sourceLabel(s)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide evidence' : `Evidence (${s.evidence.length})`}
        </Button>
      </div>

      {open && (
        <div id={panelId} className="mt-2 animate-fade-in border-t border-border pt-2">
          <EvidenceList evidence={s.evidence} />
        </div>
      )}

      {props.editable && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {inferred && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => save.mutate(s.level)}>
              Confirm level {s.level}
            </Button>
          )}
          <span className="text-label text-subtle" id={`${panelId}-lvl`}>
            {inferred ? 'or set' : 'Level'}
          </span>
          <span role="group" aria-labelledby={`${panelId}-lvl`} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((l) => (
              <button
                key={l}
                type="button"
                aria-label={`Set ${s.skill.name} to level ${l}, ${LEVEL_WORD[l]}`}
                aria-pressed={l === s.level && !inferred}
                disabled={busy}
                onClick={() => save.mutate(l)}
                className={cn(
                  'interactive press grid size-6 place-items-center rounded-xs border text-label tabular-nums disabled:opacity-50',
                  l === s.level ? 'border-default bg-raised text-strong' : 'border-border-strong text-subtle',
                )}
              >
                {l}
              </button>
            ))}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={busy}
            aria-label={`Remove ${s.skill.name}`}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
          {(save.isError || remove.isError) && (
            <span className="w-full text-label text-danger" role="alert">
              Couldn't save: {(save.error ?? remove.error)?.message}. Your other skills are unchanged.
            </span>
          )}
          {save.isSuccess && !save.isPending && (
            <span className="sr-only" role="status">
              Saved {s.skill.name}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/** Adds a skill at level 3 (adjustable after). */
function AddSkill(props: { wid: string; uid: string; existing: Set<string> }) {
  const invalidate = useInvalidateMember();
  const add = useMutation({
    mutationFn: (s: Skill) =>
      api('upsertSkill', { params: { slug: s.slug }, body: { level: 3, confirmed: true } }),
    onSuccess: () => invalidate(props.wid, props.uid),
  });
  return (
    <div>
      <SkillPicker
        label="Add a skill"
        exclude={props.existing}
        busy={add.isPending}
        onPick={(s) => add.mutate(s)}
      />
      {add.isError && (
        <p className="mt-1 text-label text-danger" role="alert">
          Couldn't add that skill: {add.error.message}
        </p>
      )}
      {add.isSuccess && (
        <p className="sr-only" role="status">
          Added {add.data.skill.name}
        </p>
      )}
    </div>
  );
}

/**
 * Taxonomy combobox: type to search, arrows to move, Enter to pick. `onPick` decides what picking means
 * (add a skill, add a learning goal…). Slugs in `exclude` are hidden.
 */
export function SkillPicker(props: {
  label: string;
  exclude: Set<string>;
  onPick: (s: Skill) => void;
  busy?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);

  const search = useQuery({
    queryKey: qk('searchSkills', { q }),
    queryFn: ({ signal }) => api('searchSkills', { query: { q }, signal }),
    enabled: q.length > 0,
  });
  const options = (search.data ?? []).filter((s) => !props.exclude.has(s.slug)).slice(0, 8);
  const pick = (s: Skill) => {
    props.onPick(s);
    setText('');
    setQ('');
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape') setOpen(false);
  };
  const showList = open && q.length > 0;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="text-label text-subtle">
        {props.label}
      </label>
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${listId}-${options[active].slug}` : undefined}
        value={text}
        placeholder={props.placeholder ?? 'Search skills, e.g. React, Postgres, Figma'}
        disabled={props.busy}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        className="field mt-1 h-control-md w-full rounded-sm px-3 text-body text-strong placeholder:text-subtle"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching skills"
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 origin-top animate-pop-in overflow-auto rounded-sm border border-border-strong bg-raised py-1 shadow-e2"
        >
          {search.isPending ? (
            <li className="px-3 py-2 text-label text-subtle">Searching…</li>
          ) : search.isError ? (
            <li className="px-3 py-2 text-label text-danger">Search failed: {search.error.message}</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-label text-subtle">No matching skills in the taxonomy.</li>
          ) : (
            options.map((s, i) => (
              <li
                key={s.slug}
                id={`${listId}-${s.slug}`}
                role="option"
                aria-selected={i === active}
                // mousedown so the input's blur doesn't close the list before the click lands
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-body',
                  i === active ? 'bg-hover text-strong' : 'text-default',
                )}
              >
                {s.name}
                <span className="text-label text-subtle">{CATEGORY_LABEL[s.category]}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Confirms every inferred skill at its suggested level. */
function LooksRight(props: { wid: string; uid: string; skills: MemberSkill[] }) {
  const invalidate = useInvalidateMember();
  const pending = props.skills.filter(isInferred);
  const confirm = useMutation({
    mutationFn: async () => {
      for (const s of pending)
        await api('upsertSkill', {
          params: { slug: s.skill.slug },
          body: { level: s.level, confirmed: true },
        });
    },
    onSettled: () => invalidate(props.wid, props.uid),
  });
  if (pending.length === 0) return null;
  return (
    <span className="flex items-center gap-2">
      {confirm.isError && (
        <span className="text-label text-danger" role="alert">
          Some skills weren't confirmed: {confirm.error.message}
        </span>
      )}
      <Button size="sm" variant="secondary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
        Looks right · confirm {pending.length}
      </Button>
    </span>
  );
}

/** Skills grouped by category, strongest first. */
export function SkillReview(props: {
  wid: string;
  uid: string;
  skills: MemberSkill[];
  editable: boolean;
  /** Shown when there are no skills at all. */
  empty: string;
}) {
  const groups = new Map<SkillCategory, MemberSkill[]>();
  for (const s of [...props.skills].sort((a, b) => b.level - a.level || b.confidence - a.confidence)) {
    const g = groups.get(s.skill.category) ?? [];
    g.push(s);
    groups.set(s.skill.category, g);
  }
  const inferredCount = props.skills.filter(isInferred).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-label text-subtle">
        <span>
          {props.skills.length} skill{props.skills.length === 1 ? '' : 's'} · {inferredCount} inferred,{' '}
          {props.skills.length - inferredCount} confirmed
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-4 rounded-xs border border-dashed border-border-strong" />
          <AiGlyph /> Inferred from GitHub: check it
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-4 rounded-xs border border-border" />
          Confirmed
        </span>
        {props.editable && (
          <span className="ml-auto">
            <LooksRight wid={props.wid} uid={props.uid} skills={props.skills} />
          </span>
        )}
      </div>

      {props.skills.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-body text-muted">
          {props.empty}
        </p>
      ) : (
        [...groups].map(([cat, list]) => (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h3 id={`cat-${cat}`} className="mb-2 text-label font-medium text-subtle uppercase">
              {CATEGORY_LABEL[cat]}
            </h3>
            <ul className="space-y-2">
              {list.map((s) => (
                <SkillRow
                  key={s.skill.slug}
                  wid={props.wid}
                  uid={props.uid}
                  skill={s}
                  editable={props.editable}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {props.editable && (
        <AddSkill wid={props.wid} uid={props.uid} existing={new Set(props.skills.map((s) => s.skill.slug))} />
      )}
    </div>
  );
}
