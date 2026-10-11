/**
 * S2 Workspace creation `/new` (DESIGN §8, T-207). Name the team, pick the hackathon template (Knight Hacks IX
 * preselected: it fills the event window, tracks, challenges and judging) or a custom event with its own deadline,
 * then `createWorkspace`. Step two (`?wid=`) is the invite panel, then onboarding for the new workspace.
 * Reached from Onboarding (no workspace yet), the top-bar workspace menu and ⌘K.
 */
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_PREFIX, type CreateWorkspace as CreateWorkspaceBody } from '@hakit/contracts';
import { Button } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useNow } from './mission-control/shared';
import { ErrorBox } from './page-states';
import { InvitePanel } from './people/InvitePanel';
import { Card, StepDots, isUnauthorized } from './people/shared';
import { DEFAULT_HACKATHON_SLUG } from './plan/ConstraintsStep';
import {
  EventPicker,
  fromLocal,
  localTimeZoneLabel,
  useHackathonTemplate,
  type EventKind,
} from './workspace/EventPicker';

const input =
  'mt-1 h-control-md w-full rounded-sm border border-border-strong bg-sunken px-3 text-body text-strong placeholder:text-subtle';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas px-6 py-10 max-sm:px-4 max-sm:py-6">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <p className="font-display text-title text-strong">hakit</p>
        {children}
      </div>
    </main>
  );
}

function CreateForm() {
  const id = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<EventKind>('hackathon');
  const [startsAt, setStartsAt] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [touched, setTouched] = useState(false);
  const now = useNow();
  const hackathon = useHackathonTemplate();
  const create = useMutation({
    mutationFn: (body: CreateWorkspaceBody) => api('createWorkspace', { body }),
    onSuccess: (w) => {
      void qc.invalidateQueries({ queryKey: qk('me') });
      navigate(`/new?wid=${encodeURIComponent(w.id)}`);
    },
  });

  const errors: Partial<Record<'name' | 'deadline' | 'start', string>> = {};
  if (!name.trim()) errors.name = 'Give your team a name.';
  if (template === 'custom') {
    if (!deadlineAt) errors.deadline = 'Pick the submission deadline.';
    else if (Date.parse(deadlineAt) <= now) errors.deadline = 'The deadline has to be in the future.';
    if (startsAt && deadlineAt && Date.parse(startsAt) >= Date.parse(deadlineAt))
      errors.start = 'The start has to be before the deadline.';
  }
  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    create.mutate(
      template === 'hackathon'
        ? { name: name.trim(), hackathonSlug: DEFAULT_HACKATHON_SLUG }
        : { name: name.trim(), deadlineAt: fromLocal(deadlineAt), startsAt: fromLocal(startsAt) },
    );
  };

  const errorText = (k: keyof typeof errors) =>
    show(k) && (
      <p id={`${id}-${k}-err`} className="mt-1 text-label text-danger">
        {show(k)}
      </p>
    );
  const described = (k: keyof typeof errors) => (show(k) ? `${id}-${k}-err` : undefined);

  return (
    <Card>
      <form onSubmit={submit} className="space-y-5" noValidate>
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
            placeholder="e.g. Team Orbit"
            aria-invalid={!!show('name') || undefined}
            aria-describedby={described('name')}
            onChange={(e) => setName(e.target.value)}
          />
          {errorText('name')}
        </div>

        <EventPicker name={`${id}-template`} value={template} onChange={setTemplate} template={hackathon} />

        {template === 'custom' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-start`} className="text-label text-subtle">
                Starts (optional)
              </label>
              <input
                id={`${id}-start`}
                type="datetime-local"
                className={input}
                value={startsAt}
                aria-invalid={!!show('start') || undefined}
                aria-describedby={described('start')}
                onChange={(e) => setStartsAt(e.target.value)}
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
                value={deadlineAt}
                aria-invalid={!!show('deadline') || undefined}
                aria-describedby={described('deadline')}
                onChange={(e) => setDeadlineAt(e.target.value)}
              />
              {errorText('deadline')}
            </div>
            <p className="text-label text-subtle sm:col-span-2">Times are in {localTimeZoneLabel()}.</p>
          </div>
        )}

        {create.isError && (
          <p role="alert" className="text-label text-danger">
            Couldn't create the workspace: {create.error.message}. Nothing was created; try again.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create workspace
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function CreateWorkspace() {
  const [search] = useSearchParams();
  const wid = search.get('wid');
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });

  if (me.isError && isUnauthorized(me.error))
    return (
      <Frame>
        <Card>
          <h1 className="text-title font-medium text-strong">Sign in to create a workspace</h1>
          <a
            href={`${API_PREFIX}/auth/github/login?next=${encodeURIComponent('/new')}`}
            className="mt-4 inline-flex h-control-lg items-center rounded-sm bg-accent-500 px-4 text-body font-medium text-strong hover:bg-accent-600"
          >
            Continue with GitHub
          </a>
        </Card>
      </Frame>
    );
  if (me.isError)
    return (
      <Frame>
        <ErrorBox what="your account" error={me.error} onRetry={() => void me.refetch()} />
      </Frame>
    );
  if (me.isPending)
    return (
      <Frame>
        <div
          className="h-96 animate-pulse rounded-md border border-border bg-surface"
          aria-busy="true"
          aria-label="Loading"
        />
      </Frame>
    );

  const first = me.data.memberships[0];
  const workspaceName = wid
    ? me.data.memberships.find((m) => m.workspaceId === wid)?.workspaceName
    : undefined;

  return (
    <Frame>
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="font-display text-display-sm text-strong">
            {wid ? 'Bring your team' : 'Create a workspace'}
          </h1>
          <span className="text-body text-subtle">
            Step {wid ? 2 : 1} of 2{workspaceName && ` · ${workspaceName}`}
          </span>
          {!wid && first && (
            <Link
              to={`/w/${first.workspaceId}/mc`}
              className="ml-auto rounded-xs text-body text-muted hover:text-strong"
            >
              Cancel
            </Link>
          )}
        </div>
        <StepDots steps={['Workspace', 'Invite']} current={wid ? 1 : 0} />
      </div>

      {wid ? (
        <>
          <InvitePanel wid={wid} />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link to={`/w/${wid}/mc`} className="rounded-xs text-body text-muted hover:text-strong">
              Skip to the workspace
            </Link>
            <Link
              to={`/onboarding?wid=${encodeURIComponent(wid)}`}
              className="inline-flex h-control-md items-center rounded-sm bg-accent-500 px-3 text-body font-medium text-strong hover:bg-accent-600"
            >
              Set up your profile
            </Link>
          </div>
        </>
      ) : (
        <CreateForm />
      )}
    </Frame>
  );
}
