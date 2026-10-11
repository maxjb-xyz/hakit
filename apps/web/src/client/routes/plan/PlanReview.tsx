/**
 * S8 plan sections (T-307): Summary → MVP scope with cut line → Architecture → Milestones → Tasks → Risks, plus the
 * deterministic feasibility banner. Used both while a plan streams in (read-only, partial) and for a saved version
 * (inline-editable when it is a draft; edits are collected by the parent and saved as one PlanPatch).
 */
import { useId, useState, type ReactNode } from 'react';
import type { Feasibility, Member, PlanOutline, ScopeTier, TaskDraft } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { AiGlyph } from '../mission-control/RecommendationList';
import { clock, fmtHours } from '../mission-control/shared';
import { Picker } from '../tasks/meta';
import { Pill } from '../page-states';
import type { PlanEdits, ScopeKey } from './draft';
import { nextTaskKey } from './draft';
import { EstimatedBar, Field, SectionHead, StatusMark, WhoKnows, fieldClass, stagger } from './ui';

const TIER_LABEL: Record<ScopeTier, string> = { must: 'Must', should: 'Should', could: 'Could' };

/* ------------------------------- feasibility ------------------------------- */

/** "Plan needs ≈74h; team has ≈80h → 1 task moved below the cut line (T4)." Numbers come from the engine. */
export function FeasibilityBanner(props: { f: Feasibility; stale?: boolean }) {
  const { f } = props;
  const over = f.requiredHours > f.availableEffectiveHours;
  const late = f.criticalPathHours > f.hoursUntilFinalMilestone;
  const errors = f.issues.filter((i) => i.severity === 'error').length;
  const mark = errors || !f.ok ? 'bad' : over || late || f.cutTaskKeys.length ? 'warn' : 'ok';
  const word = errors || !f.ok ? 'Not feasible' : mark === 'warn' ? 'Feasible with cuts' : 'Feasible';
  return (
    <section
      aria-label="Feasibility"
      className={cn(
        'animate-fade-in space-y-3 rounded-md border border-l-2 bg-surface px-4 py-3',
        mark === 'bad'
          ? 'border-danger'
          : mark === 'warn'
            ? 'border-border border-l-warning'
            : 'border-border border-l-success',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            'rounded-full border px-2 py-0.5',
            mark === 'bad' ? 'border-danger' : mark === 'warn' ? 'border-warning' : 'border-success',
          )}
        >
          <StatusMark mark={mark} word={word} />
        </span>
        <p className="text-body text-default">
          Plan needs <strong className="text-strong">≈ {fmtHours(f.requiredHours)}</strong>; team has{' '}
          <strong className="text-strong">≈ {fmtHours(f.availableEffectiveHours)}</strong> available
          {f.cutTaskKeys.length > 0 ? (
            <>
              {' '}
              → {f.cutTaskKeys.length} task{f.cutTaskKeys.length === 1 ? '' : 's'} moved below the cut line (
              <span className="font-mono">{f.cutTaskKeys.join(', ')}</span>).
            </>
          ) : (
            '.'
          )}
        </p>
        <span className="ml-auto text-caption text-subtle">
          Estimated · computed by the plan validator, not AI
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex justify-between text-label">
            <span className="text-muted">Work vs capacity</span>
            <span className="text-default">
              ≈{fmtHours(f.requiredHours)} / ≈{fmtHours(f.availableEffectiveHours)}
            </span>
          </div>
          <EstimatedBar
            value={f.requiredHours}
            max={f.availableEffectiveHours}
            label="Estimated work vs capacity"
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-label">
            <span className="text-muted">Critical path vs final milestone</span>
            <span className="text-default">
              ≈{fmtHours(f.criticalPathHours)} / {fmtHours(f.hoursUntilFinalMilestone)}
            </span>
          </div>
          <EstimatedBar
            value={f.criticalPathHours}
            max={f.hoursUntilFinalMilestone}
            label="Estimated critical path vs hours until the final milestone"
          />
        </div>
      </div>
      {props.stale && (
        <p className="text-label text-warning" role="status">
          <span aria-hidden>⚠ </span>You have unsaved edits. These numbers update when you save a new version.
        </p>
      )}
    </section>
  );
}

/* --------------------------------- sections --------------------------------- */

function Block(props: {
  index?: number;
  id: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={props.id}
      style={stagger(props.index ?? 0)}
      className="animate-list-in space-y-3 rounded-md border border-border bg-surface p-4"
    >
      <SectionHead id={props.id} title={props.title} meta={props.meta}>
        {props.actions}
      </SectionHead>
      {props.children}
    </section>
  );
}

function Waiting({ what }: { what: string }) {
  return (
    <div aria-busy="true" className="space-y-2">
      <p className="flex items-center gap-2 text-label text-subtle">
        <AiGlyph /> Waiting for {what}…
      </p>
      <div className="skeleton h-4 rounded-xs" />
      <div className="skeleton h-4 w-5/6 rounded-xs" />
      <div className="skeleton h-4 w-2/3 rounded-xs" />
    </div>
  );
}

export interface ReviewProps {
  outline: PlanOutline | null;
  tasks: TaskDraft[];
  feasibility: Feasibility | null;
  members: Member[];
  startsAt: string | null;
  /** Present only for an editable draft. */
  edit?: { edits: PlanEdits; set: (fn: (e: PlanEdits) => PlanEdits) => void };
  streaming?: boolean;
}

export function PlanSections(p: ReviewProps) {
  return (
    <div className="space-y-4">
      {p.feasibility ? (
        <FeasibilityBanner f={p.feasibility} stale={!!p.edit && hasEdits(p.edit.edits)} />
      ) : (
        p.streaming && (
          <div className="skeleton rounded-md border border-dashed border-border-strong px-4 py-3 text-label text-subtle">
            Feasibility appears once the validator has checked every task.
          </div>
        )
      )}
      <Summary {...p} />
      <Scope {...p} />
      <Architecture {...p} />
      <Milestones {...p} />
      <Tasks {...p} />
      <Risks {...p} />
    </div>
  );
}

const hasEdits = (e: PlanEdits) =>
  e.summary !== undefined ||
  Object.keys(e.scope).length > 0 ||
  Object.keys(e.tasks).length > 0 ||
  e.removed.length > 0;

function EditToggle(props: { editing: boolean; onClick: () => void; what: string }) {
  return (
    <Button size="sm" variant="ghost" aria-expanded={props.editing} onClick={props.onClick}>
      <span aria-hidden className="mr-1">
        {props.editing ? '✓' : '✎'}
      </span>
      {props.editing ? 'Done' : 'Edit'}
      <span className="sr-only"> {props.what}</span>
    </Button>
  );
}

function Summary({ outline, edit, streaming }: ReviewProps) {
  const [editing, setEditing] = useState(false);
  return (
    <Block
      index={0}
      id="plan-summary"
      title="Summary"
      actions={
        edit &&
        outline && <EditToggle editing={editing} onClick={() => setEditing(!editing)} what="summary" />
      }
    >
      {!outline ? (
        streaming ? (
          <Waiting what="the outline" />
        ) : null
      ) : editing && edit ? (
        <Field
          className="animate-fade-in"
          label="Summary"
          multiline
          rows={3}
          value={outline.summary}
          onChange={(v) => edit.set((e) => ({ ...e, summary: v }))}
        />
      ) : (
        <p className="text-body-lg text-default">{outline.summary}</p>
      )}
    </Block>
  );
}

const SCOPE_ROWS: [ScopeKey, string][] = [
  ['must', 'Must have'],
  ['should', 'Should have'],
  ['could', 'Could have'],
];

function Scope({ outline, edit, feasibility, streaming }: ReviewProps) {
  const [editing, setEditing] = useState(false);
  const setTier = (tier: ScopeKey, text: string) =>
    edit?.set((e) => ({
      ...e,
      scope: {
        ...e.scope,
        [tier]: text
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    }));
  const cut = feasibility?.cutTaskKeys ?? [];
  return (
    <Block
      index={1}
      id="plan-scope"
      title="MVP scope"
      meta="must / should / could, with the cut line"
      actions={
        edit && outline && <EditToggle editing={editing} onClick={() => setEditing(!editing)} what="scope" />
      }
    >
      {!outline ? (
        streaming ? (
          <Waiting what="scope" />
        ) : null
      ) : (
        <div className="space-y-3">
          {SCOPE_ROWS.map(([tier, label]) => (
            <ScopeTierView
              key={tier}
              label={label}
              items={outline.scope[tier]}
              editing={editing && !!edit}
              onChange={(t) => setTier(tier, t)}
            />
          ))}
          <div className="flex items-center gap-2" role="separator" aria-label="Cut line">
            <span className="h-px flex-1 border-t border-dashed border-warning" />
            <span className="text-caption uppercase tracking-wide text-warning">
              <span aria-hidden>✂ </span>Cut line
            </span>
            <span className="h-px flex-1 border-t border-dashed border-warning" />
          </div>
          <div className="space-y-1">
            <h3 className="text-caption uppercase tracking-wide text-subtle">Below the cut line</h3>
            {cut.length === 0 ? (
              <p className="text-body text-subtle">Nothing cut: the retained scope fits capacity.</p>
            ) : (
              <p className="text-body text-default">
                Tasks <span className="font-mono">{cut.join(', ')}</span> were moved out by the validator to
                fit team capacity. Edit the plan to bring them back.
              </p>
            )}
          </div>
          <ScopeTierView
            label="Out of scope"
            items={outline.scope.outOfScope}
            editing={editing && !!edit}
            onChange={(t) => setTier('outOfScope', t)}
            muted
          />
        </div>
      )}
    </Block>
  );
}

function ScopeTierView(props: {
  label: string;
  items: string[];
  editing: boolean;
  onChange: (text: string) => void;
  muted?: boolean;
}) {
  if (props.editing)
    return (
      <Field
        label={`${props.label} (one per line)`}
        multiline
        rows={Math.max(2, props.items.length + 1)}
        value={props.items.join('\n')}
        onChange={props.onChange}
      />
    );
  return (
    <div>
      <h3 className="text-caption uppercase tracking-wide text-subtle">{props.label}</h3>
      {props.items.length === 0 ? (
        <p className="text-body text-subtle">Nothing here.</p>
      ) : (
        <ul
          className={cn(
            'mt-1 list-disc space-y-0.5 pl-4 text-body',
            props.muted ? 'text-muted line-through' : 'text-default',
          )}
        >
          {props.items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Architecture({ outline, members, streaming }: ReviewProps) {
  return (
    <Block
      index={2}
      id="plan-arch"
      title="Architecture"
      meta={outline ? `${outline.architecture.components.length} components` : undefined}
    >
      {!outline ? (
        streaming ? (
          <Waiting what="architecture" />
        ) : null
      ) : (
        <div className="space-y-4">
          <div
            className="relative overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Plan tasks, scrolls sideways"
          >
            <table className="w-full min-w-(--spacing-table-min) text-left text-body">
              <thead className="text-caption uppercase tracking-wide text-subtle">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Component
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Responsibility
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Tech
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Who knows this
                  </th>
                </tr>
              </thead>
              <tbody>
                {outline.architecture.components.map((c) => (
                  <tr key={c.name} className="border-t border-border">
                    <td className="py-2 pr-3 text-strong">{c.name}</td>
                    <td className="py-2 pr-3 text-default">{c.responsibility}</td>
                    <td className="py-2 pr-3 text-default">{c.tech}</td>
                    <td className="py-2">
                      <WhoKnows slugs={c.skillSlugs} members={members} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {outline.architecture.dataFlow.length > 0 && (
            <div>
              <h3 className="text-caption uppercase tracking-wide text-subtle">Data flow</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 font-mono text-label text-default">
                {outline.architecture.dataFlow.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

function Milestones({ outline, startsAt, feasibility, streaming }: ReviewProps) {
  if (!outline)
    return streaming ? (
      <Block id="plan-ms" title="Milestones">
        <Waiting what="milestones" />
      </Block>
    ) : null;
  const ms = [...outline.milestones].sort((a, b) => a.targetHour - b.targetHour);
  const span = Math.max(feasibility?.hoursUntilFinalMilestone ?? 0, ...ms.map((m) => m.targetHour), 1);
  const at = (h: number) =>
    startsAt ? clock(new Date(Date.parse(startsAt) + h * 3_600_000).toISOString()) : null;
  return (
    <Block index={3} id="plan-ms" title="Milestones" meta="hours after hacking starts">
      <div className="relative mx-2 h-6" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 border-t border-border-strong" />
        {ms.map((m) => (
          <span
            key={m.key}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(m.targetHour / span) * 100}%` }}
          >
            <span className="block size-2.5 animate-pop-in rotate-45 border border-accent-400 bg-surface" />
          </span>
        ))}
      </div>
      <ol className="grid gap-2 sm:grid-cols-3">
        {ms.map((m, i) => (
          <li
            key={m.key}
            style={stagger(i)}
            className="animate-list-in rounded-sm border border-border px-3 py-2"
          >
            <p className="text-label text-subtle">
              <span className="font-mono">{m.key}</span> · H+{m.targetHour}
              {at(m.targetHour) && ` · ${at(m.targetHour)}`}
            </p>
            <p className="text-body text-strong">{m.title}</p>
          </li>
        ))}
      </ol>
    </Block>
  );
}

function Tasks({ outline, tasks, members, edit, streaming, feasibility }: ReviewProps) {
  const cut = new Set(feasibility?.cutTaskKeys ?? []);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  if (!outline && tasks.length === 0)
    return streaming ? (
      <Block id="plan-tasks" title="Tasks">
        <Waiting what="tasks" />
      </Block>
    ) : null;
  const epics = outline?.epics ?? [];
  const msOf = (epicKey: string) => epics.find((e) => e.key === epicKey)?.milestoneKey ?? null;
  const groups = [
    ...(outline?.milestones ?? []).map((m) => ({ key: m.key, title: `${m.key} · ${m.title}` })),
    { key: null as string | null, title: 'No milestone' },
  ];
  const total = tasks.reduce((s, t) => s + t.estimateHours, 0);

  const save = (t: TaskDraft) => edit?.set((e) => ({ ...e, tasks: { ...e.tasks, [t.key]: t } }));
  const remove = (key: string) =>
    edit?.set((e) => {
      const { [key]: _drop, ...rest } = e.tasks;
      return { ...e, tasks: rest, removed: [...e.removed, key] };
    });
  const add = (epicKey: string) => {
    const key = nextTaskKey([...tasks, ...(edit?.edits.removed ?? []).map((k) => ({ key: k }))]);
    save({
      key,
      epicKey,
      title: 'New task',
      description: '',
      acceptanceCriteria: ['Done when reviewed'],
      estimateHours: 2,
      requiredSkills: tasks.find((t) => t.epicKey === epicKey)?.requiredSkills.slice(0, 1) ?? [
        { slug: 'typescript', level: 2, weight: 1 },
      ],
      dependsOn: [],
      priority: 'should',
    });
    setEditingKey(key);
  };

  return (
    <Block
      index={4}
      id="plan-tasks"
      title="Tasks"
      meta={`${tasks.length} · ≈${fmtHours(total)} estimated${cut.size ? ` · ${cut.size} cut` : ''}`}
    >
      {streaming && <p className="text-label text-subtle">More tasks arrive as each epic finishes…</p>}
      <div className="space-y-4">
        {groups.map((g) => {
          const list = tasks.filter((t) => msOf(t.epicKey) === g.key);
          const groupEpics = epics.filter((e) => e.milestoneKey === g.key);
          if (list.length === 0 && (!edit || groupEpics.length === 0)) return null;
          return (
            <div key={g.key ?? 'none'}>
              <div className="flex items-center gap-2 border-b border-border pb-1">
                <h3 className="text-label font-medium text-default">{g.title}</h3>
                <span className="text-label text-subtle">
                  {list.length} · ≈{fmtHours(list.reduce((s, t) => s + t.estimateHours, 0))}
                </span>
                {edit && groupEpics[0] && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => add(groupEpics[0]!.key)}
                  >
                    + Add task<span className="sr-only"> to {g.title}</span>
                  </Button>
                )}
              </div>
              <ul>
                {list.map((t) =>
                  edit && editingKey === t.key ? (
                    <TaskEditor
                      key={t.key}
                      task={t}
                      epics={epics.map((e) => ({ key: e.key, title: e.title }))}
                      onSave={(next) => {
                        save(next);
                        setEditingKey(null);
                      }}
                      onCancel={() => setEditingKey(null)}
                    />
                  ) : (
                    <TaskLine
                      key={t.key}
                      task={t}
                      cut={cut.has(t.key)}
                      members={members}
                      edited={!!edit?.edits.tasks[t.key]}
                      onEdit={edit ? () => setEditingKey(t.key) : undefined}
                      onRemove={edit ? () => remove(t.key) : undefined}
                      onPriority={edit ? (priority) => save({ ...t, priority }) : undefined}
                    />
                  ),
                )}
              </ul>
            </div>
          );
        })}
        {edit && edit.edits.removed.length > 0 && (
          <p className="text-label text-subtle">
            Removed (unsaved): <span className="font-mono">{edit.edits.removed.join(', ')}</span>{' '}
            <Button size="sm" variant="ghost" onClick={() => edit.set((e) => ({ ...e, removed: [] }))}>
              Restore all
            </Button>
          </p>
        )}
      </div>
    </Block>
  );
}

function TaskLine(props: {
  task: TaskDraft;
  cut?: boolean;
  members: Member[];
  edited: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onPriority?: (p: ScopeTier) => void;
}) {
  const t = props.task;
  return (
    <li
      className={cn(
        'group -mx-2 flex animate-fade-in flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border-b border-border px-2 py-2 transition-colors duration-(--duration-instant) last:border-b-0 hover:bg-hover',
        props.cut && 'opacity-80',
        props.edited && 'shadow-[inset_2px_0_0_var(--color-accent-400)]',
      )}
    >
      <span className="w-10 shrink-0 font-mono text-label text-subtle">{t.key}</span>
      <span
        className={cn('min-w-0 flex-1 text-body', props.cut ? 'text-muted line-through' : 'text-default')}
      >
        {t.title}
        {props.cut && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-warning px-1.5 text-caption text-warning no-underline">
            <span aria-hidden>✂</span> Cut to fit capacity
          </span>
        )}
        {props.edited && (
          <span className="ml-2 animate-pop-in rounded-full bg-accent-a12 px-1.5 text-caption text-accent-400">
            edited
          </span>
        )}
        {t.dependsOn.length > 0 && (
          <span className="ml-2 text-caption text-subtle">after {t.dependsOn.join(', ')}</span>
        )}
      </span>
      <span className="flex flex-wrap gap-1">
        {t.requiredSkills.map((s) => (
          <Pill key={s.slug} className="font-mono" title={`Needs level ${s.level}`}>
            {s.slug} {s.level}
          </Pill>
        ))}
      </span>
      {props.onPriority ? (
        <Picker
          label={`Priority of ${t.key}`}
          value={t.priority}
          onChange={(v) => props.onPriority!(v as ScopeTier)}
        >
          {(['must', 'should', 'could'] as const).map((p) => (
            <option key={p} value={p}>
              {TIER_LABEL[p]}
            </option>
          ))}
        </Picker>
      ) : (
        <Pill tone={t.priority === 'must' ? 'accent' : 'muted'}>{TIER_LABEL[t.priority]}</Pill>
      )}
      <span className="w-10 shrink-0 text-right text-label text-subtle" title="Estimated hours">
        ≈{fmtHours(t.estimateHours)}
      </span>
      <WhoKnows slugs={t.requiredSkills.map((s) => s.slug)} members={props.members} />
      {props.onEdit && (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={props.onEdit}>
            Edit<span className="sr-only"> {t.key}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onRemove}>
            Remove<span className="sr-only"> {t.key}</span>
          </Button>
        </span>
      )}
    </li>
  );
}

function TaskEditor(props: {
  task: TaskDraft;
  epics: { key: string; title: string }[];
  onSave: (t: TaskDraft) => void;
  onCancel: () => void;
}) {
  const [t, setT] = useState(props.task);
  const estId = useId();
  const epicId = useId();
  const valid = t.title.trim().length > 0 && t.estimateHours >= 0.5 && t.estimateHours <= 8;
  return (
    <li className="-mx-2 animate-fade-in space-y-3 rounded-sm border border-accent-400 bg-raised px-3 py-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) props.onSave({ ...t, title: t.title.trim() });
        }}
        onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
      >
        <p className="font-mono text-label text-subtle">{t.key}</p>
        <Field label="Title" value={t.title} onChange={(title) => setT({ ...t, title })} required />
        <Field
          label="Description"
          multiline
          rows={2}
          value={t.description}
          onChange={(description) => setT({ ...t, description })}
        />
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <label htmlFor={estId} className="block text-label text-muted">
              Estimate (hours, 0.5–8)
            </label>
            <input
              id={estId}
              type="number"
              min={0.5}
              max={8}
              step={0.5}
              value={t.estimateHours}
              onChange={(e) => setT({ ...t, estimateHours: Number(e.target.value) })}
              className={cn(fieldClass, 'h-control-lg w-24 py-0')}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={epicId} className="block text-label text-muted">
              Epic
            </label>
            <select
              id={epicId}
              value={t.epicKey}
              onChange={(e) => setT({ ...t, epicKey: e.target.value })}
              className={cn(fieldClass, 'h-control-lg py-0')}
            >
              {props.epics.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.key} · {e.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" type="submit" disabled={!valid}>
            Keep edit
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={props.onCancel}>
            Cancel
          </Button>
          {!valid && (
            <span className="text-label text-warning">Needs a title and an estimate of 0.5–8h.</span>
          )}
        </div>
      </form>
    </li>
  );
}

function Risks({ outline, feasibility, streaming }: ReviewProps) {
  if (!outline && !feasibility)
    return streaming ? (
      <Block id="plan-risks" title="Risks">
        <Waiting what="risks" />
      </Block>
    ) : null;
  const issues = feasibility?.issues ?? [];
  const risks = outline?.risks ?? [];
  return (
    <Block index={5} id="plan-risks" title="Risks" meta={issues.length + risks.length}>
      {issues.length + risks.length === 0 ? (
        <p className="text-body text-subtle">No risks flagged.</p>
      ) : (
        <ul className="space-y-2 text-body">
          {issues.map((i) => (
            <li key={`${i.code}-${i.message}`} className="flex flex-wrap items-baseline gap-2">
              <StatusMark
                mark={i.severity === 'error' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}
                word={i.severity === 'error' ? 'Error' : i.severity === 'warn' ? 'Warning' : 'Note'}
              />
              <span className="min-w-0 flex-1 text-default">{i.message}</span>
              <span className="font-mono text-caption text-subtle">{i.code}</span>
            </li>
          ))}
          {risks.map((r) => (
            <li key={r} className="flex items-baseline gap-2">
              <span className="inline-flex items-center gap-1 text-label text-subtle">
                <AiGlyph /> AI
              </span>
              <span className="text-default">{r}</span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
