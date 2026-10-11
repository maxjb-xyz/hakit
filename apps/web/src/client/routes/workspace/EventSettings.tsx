/**
 * S14 Settings › Event (DESIGN §8): the ongoing hackathon. Owners edit the team name, the hackathon template and
 * the event window (`updateWorkspace`); members see the same facts read-only. Below it, the workspace's projects:
 * status, which one every screen is showing (`useProject`), and a "New project" action (`createProject`).
 */
import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project, UpdateWorkspace, Workspace } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { qk } from '../../lib/query';
import { Panel, ago, useNow } from '../mission-control/shared';
import { EmptyBox, ErrorBox, LoadingBlocks, Pill } from '../page-states';
import { DEFAULT_HACKATHON_SLUG } from '../plan/ConstraintsStep';
import {
  EventPicker,
  fmtDay,
  fromLocal,
  localTimeZoneLabel,
  toLocal,
  useHackathonTemplate,
  type EventKind,
} from './EventPicker';

const input =
  'mt-1 h-control-md w-full rounded-sm border border-border-strong bg-sunken px-3 text-body text-strong placeholder:text-subtle disabled:text-muted';

/* --------------------------------- Event --------------------------------- */

export function EventPanel({ wid }: { wid: string }) {
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const [saved, setSaved] = useState(false);
  const isOwner = me.data?.memberships.some((m) => m.workspaceId === wid && m.role === 'owner') ?? false;

  return (
    <Panel
      title="Event"
      meta={me.data && !isOwner ? 'Read-only · only the workspace owner can change these' : undefined}
    >
      <div className="p-4">
        {workspace.isPending || me.isPending ? (
          <LoadingBlocks label="Loading event settings" rows={2} />
        ) : workspace.isError ? (
          <ErrorBox
            what="the event settings"
            error={workspace.error}
            onRetry={() => void workspace.refetch()}
          />
        ) : isOwner ? (
          <EventForm
            // Re-seed the form whenever the server copy changes (after a save or a refetch).
            key={JSON.stringify(workspace.data)}
            wid={wid}
            workspace={workspace.data}
            saved={saved}
            onSaved={() => setSaved(true)}
            onEdit={() => setSaved(false)}
          />
        ) : (
          <EventReadOnly workspace={workspace.data} />
        )}
      </div>
    </Panel>
  );
}

function EventReadOnly({ workspace: w }: { workspace: Workspace }) {
  const template = useHackathonTemplate(w.hackathonSlug ?? DEFAULT_HACKATHON_SLUG);
  return (
    <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-(--grid-lane-legend)">
      <dt className="text-muted">Team name</dt>
      <dd className="text-default">{w.name}</dd>
      <dt className="text-muted">Event</dt>
      <dd className="text-default">
        {w.hackathonSlug ? (template.data?.name ?? w.hackathonSlug) : 'Custom event'}
      </dd>
      <dt className="text-muted">Starts</dt>
      <dd className="text-default">{w.startsAt ? fmtDay(w.startsAt) : 'Not set'}</dd>
      <dt className="text-muted">Submission deadline</dt>
      <dd className="text-default">{fmtDay(w.deadlineAt)}</dd>
    </dl>
  );
}

type FieldKey = 'name' | 'start' | 'deadline';

function EventForm(props: {
  wid: string;
  workspace: Workspace;
  saved: boolean;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const { wid, workspace: w } = props;
  const id = useId();
  const qc = useQueryClient();
  const slug = w.hackathonSlug ?? DEFAULT_HACKATHON_SLUG;
  const template = useHackathonTemplate(slug);
  const initial = {
    name: w.name,
    kind: (w.hackathonSlug ? 'hackathon' : 'custom') as EventKind,
    start: toLocal(w.startsAt),
    deadline: toLocal(w.deadlineAt),
  };
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<EventKind>(initial.kind);
  const [start, setStart] = useState(initial.start);
  const [deadline, setDeadline] = useState(initial.deadline);
  const [touched, setTouched] = useState(false);

  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      props.onEdit();
    };

  const pickKind = (k: EventKind) => {
    edit(setKind)(k);
    // Switching (back) to the template brings its official window, as on creation; dates stay editable.
    if (k === 'hackathon' && initial.kind === 'custom' && template.data) {
      setStart(toLocal(template.data.startsAt));
      setDeadline(toLocal(template.data.endsAt));
    }
  };

  // Only what changed is sent, so untouched dates keep their exact (second-precision) server values.
  const body: UpdateWorkspace = {};
  if (name.trim() !== initial.name) body.name = name.trim();
  if (kind !== initial.kind) body.hackathonSlug = kind === 'hackathon' ? slug : null;
  if (start !== initial.start) body.startsAt = start ? fromLocal(start)! : null;
  if (deadline !== initial.deadline && deadline) body.deadlineAt = fromLocal(deadline);
  const dirty = Object.keys(body).length > 0;

  const errors: Partial<Record<FieldKey, string>> = {};
  if (!name.trim()) errors.name = 'Give your team a name.';
  if (!deadline) errors.deadline = 'Pick the submission deadline.';
  else if (start && Date.parse(start) >= Date.parse(deadline))
    errors.start = 'The start has to be before the deadline.';
  const show = (k: FieldKey) => (touched ? errors[k] : undefined);

  const save = useMutation({
    mutationFn: (b: UpdateWorkspace) => api('updateWorkspace', { params: { wid }, body: b }),
    onSuccess: (updated) => {
      qc.setQueryData(qk('getWorkspace', { wid }), updated);
      props.onSaved();
      void qc.invalidateQueries({ queryKey: qk('getWorkspace', { wid }) });
      void qc.invalidateQueries({ queryKey: qk('me') });
      void qc.invalidateQueries({ queryKey: qk('missionControl') });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || !dirty) return;
    save.mutate(body);
  };
  const reset = () => {
    setName(initial.name);
    setKind(initial.kind);
    setStart(initial.start);
    setDeadline(initial.deadline);
    setTouched(false);
    save.reset();
  };

  const errorText = (k: FieldKey) =>
    show(k) && (
      <p id={`${id}-${k}-err`} className="mt-1 text-label text-danger">
        {show(k)}
      </p>
    );
  const described = (k: FieldKey, hint?: string) =>
    [show(k) ? `${id}-${k}-err` : undefined, hint].filter(Boolean).join(' ') || undefined;
  const tzHint = `${id}-tz`;
  const officialZone = kind === 'hackathon' ? template.data?.timezone : undefined;
  const localZone = localTimeZoneLabel();

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5" noValidate>
      <div>
        <label htmlFor={`${id}-name`} className="text-label text-subtle">
          Team name
        </label>
        <input
          id={`${id}-name`}
          className={input}
          maxLength={80}
          autoComplete="off"
          value={name}
          aria-invalid={!!show('name') || undefined}
          aria-describedby={described('name')}
          onChange={(e) => edit(setName)(e.target.value)}
        />
        {errorText('name')}
      </div>

      <EventPicker
        name={`${id}-template`}
        value={kind}
        onChange={pickKind}
        template={template}
        customHint="Not on the template. Keep the team, projects and dates; set the window yourself."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-start`} className="text-label text-subtle">
            Starts (optional)
          </label>
          <input
            id={`${id}-start`}
            type="datetime-local"
            className={input}
            value={start}
            aria-invalid={!!show('start') || undefined}
            aria-describedby={described('start', tzHint)}
            onChange={(e) => edit(setStart)(e.target.value)}
          />
          {errorText('start')}
        </div>
        <div>
          <label htmlFor={`${id}-deadline`} className="text-label text-subtle">
            Submission deadline
          </label>
          <input
            id={`${id}-deadline`}
            type="datetime-local"
            className={input}
            value={deadline}
            aria-invalid={!!show('deadline') || undefined}
            aria-describedby={described('deadline', tzHint)}
            onChange={(e) => edit(setDeadline)(e.target.value)}
          />
          {errorText('deadline')}
        </div>
        <p id={tzHint} className="text-label text-subtle sm:col-span-2">
          Times are in your time zone, {localZone}.
          {officialZone && !localZone.startsWith(officialZone) && (
            <>
              {' '}
              The event runs on {officialZone} time
              {deadline && `: deadline ${fmtDay(new Date(deadline).toISOString(), officialZone)}`}.
            </>
          )}
        </p>
      </div>

      {save.isError && (
        <p role="alert" className="text-label text-danger">
          Couldn't save the event settings ({save.error.message}). Nothing was changed; try again.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p role="status" className="mr-auto text-label text-success">
          {props.saved && !dirty && !save.isPending && 'Saved. The countdown and plans use the new dates.'}
        </p>
        <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={reset}>
          Discard changes
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
          Save event
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------- Projects -------------------------------- */

const PROJECT_STATUS: Record<
  Project['status'],
  { label: string; tone: 'muted' | 'info' | 'success' | 'accent' }
> = {
  ideating: { label: 'Ideating', tone: 'muted' },
  planning: { label: 'Planning', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  submitted: { label: 'Submitted', tone: 'accent' },
};

export function ProjectsPanel({ wid }: { wid: string }) {
  const now = useNow();
  const { project: selected, projects, query, select } = useProject(wid);
  // The rail's project menu links here with ?newProject=1 to open the form straight away.
  const [search] = useSearchParams();
  const [creating, setCreating] = useState(() => search.get('newProject') === '1');
  const sorted = [...projects].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <Panel title="Projects" meta={query.data ? `${query.data.length} in this workspace` : undefined}>
      <div className="space-y-3 p-2">
        {query.isPending ? (
          <LoadingBlocks label="Loading projects" rows={2} />
        ) : query.isError ? (
          <ErrorBox what="projects" error={query.error} onRetry={() => void query.refetch()} />
        ) : sorted.length === 0 && !creating ? (
          <EmptyBox
            message="No project yet. Create one to start planning; you can pick the idea next."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New project
              </Button>
            }
          />
        ) : (
          <>
            {sorted.length > 0 && (
              <ul className="divide-y divide-border" aria-label="Projects">
                {sorted.map((p) => {
                  const isSelected = p.id === selected?.id;
                  const status = PROJECT_STATUS[p.status];
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body text-default">{p.name}</p>
                        <p className="truncate text-label text-subtle">
                          Created {ago(p.createdAt, now)}
                          {p.pitch && ` · ${p.pitch}`}
                        </p>
                      </div>
                      <Pill tone={status.tone}>{status.label}</Pill>
                      {isSelected ? (
                        <Pill tone="accent" className="border-accent-500">
                          <span aria-hidden>✓</span> Showing on every screen
                        </Pill>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Show ${p.name} on every screen`}
                          onClick={() => select(p.id)}
                        >
                          Switch to this
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {creating ? (
              <NewProjectForm
                wid={wid}
                onDone={(p) => {
                  setCreating(false);
                  if (p) select(p.id);
                }}
              />
            ) : (
              <div className="px-2 pb-2">
                <Button onClick={() => setCreating(true)}>New project</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function NewProjectForm(props: { wid: string; onDone: (p: Project | null) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api('createProject', { params: { wid: props.wid }, body: { name: name.trim() } }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: qk('listProjects', { wid: props.wid }) });
      props.onDone(p);
    },
  });
  const valid = name.trim().length > 0;
  return (
    <form
      className={cn('flex flex-wrap items-end gap-2 rounded-md border border-border p-3')}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) create.mutate();
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={`${id}-name`} className="text-label text-subtle">
          Project name
        </label>
        <input
          id={`${id}-name`}
          className={input}
          maxLength={80}
          autoComplete="off"
          // The form only appears after "New project" is pressed, so moving focus into it is expected.
          autoFocus
          value={name}
          placeholder="e.g. Hakit"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') props.onDone(null);
          }}
        />
      </div>
      <Button type="submit" variant="primary" disabled={!valid} loading={create.isPending}>
        Create project
      </Button>
      <Button type="button" variant="ghost" onClick={() => props.onDone(null)}>
        Cancel
      </Button>
      {create.isError && (
        <p role="alert" className="basis-full text-label text-danger">
          Couldn't create the project ({create.error.message}). Nothing was created.
        </p>
      )}
    </form>
  );
}
