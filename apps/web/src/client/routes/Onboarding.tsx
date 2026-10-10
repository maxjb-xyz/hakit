/**
 * S1/S3 Onboarding (DESIGN §8, T-207/T-208). Three steps with progress dots, each its own `?step=`:
 *   1. Profile basics: GitHub identity, headline, timezone (auto-detected), interests → `updateProfile`.
 *   2. Skill import (S3): `importSkills` with a staged checklist, then review inferred skills
 *      (confirm / adjust / remove / add via `upsertSkill`, `removeSkill`, `searchSkills`).
 *   3. Availability & preferences: hour timeline of the event + want-to-learn / prefer-to-avoid tags.
 *      Finishing (or skipping) marks onboarding complete (`completeOnboarding`) and opens the workspace.
 * Workspace comes from `?wid=` (set by the invite flow) or the member's first workspace.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { API_PREFIX, type MemberProfile, type UpdateMemberProfile } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { AvailabilityEditor } from './people/AvailabilityEditor';
import { SkillImportPanel, useImportSkills } from './people/SkillImport';
import { SkillPicker, SkillReview } from './people/SkillReview';
import { Card, PersonAvatar, StepDots, isUnauthorized, useInvalidateMember } from './people/shared';
import { ErrorBox } from './page-states';

const STEPS = ['profile', 'skills', 'availability'] as const;
type Step = (typeof STEPS)[number];
const STEP_LABEL = ['Profile', 'Skills', 'Availability'];

const input =
  'mt-1 h-control-md w-full rounded-sm border border-border-strong bg-sunken px-3 text-body text-strong placeholder:text-subtle';

function Frame({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-dvh bg-canvas px-6 py-10 max-sm:px-4 max-sm:py-6">
      <div className={cn('mx-auto w-full space-y-6', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <p className="font-display text-title text-strong">hakit</p>
        {children}
      </div>
    </main>
  );
}

function useProfileSave(wid: string, uid: string, onSaved?: (p: MemberProfile) => void) {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: (body: UpdateMemberProfile) => api('updateProfile', { params: { wid, uid }, body }),
    onSuccess: (p) => {
      invalidate(wid, uid);
      onSaved?.(p);
    },
  });
}

/* ----------------------------- step 1 ----------------------------- */

function ProfileStep(props: {
  wid: string;
  uid: string;
  profile: MemberProfile;
  name: string;
  login: string;
  avatarUrl: string | null;
  next: () => void;
}) {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [headline, setHeadline] = useState(props.profile.headline ?? '');
  const [timezone, setTimezone] = useState(props.profile.timezone || detected);
  const [interests, setInterests] = useState(props.profile.interests.join(', '));
  const save = useProfileSave(props.wid, props.uid, props.next);
  const zones = (() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [timezone];
    }
  })();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      headline: headline.trim() || null,
      timezone,
      interests: interests
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
    });
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center gap-3">
          <PersonAvatar
            name={props.name}
            avatarUrl={props.avatarUrl}
            className="size-10 text-body"
            decorative
          />
          <div className="min-w-0">
            <p className="truncate text-body-lg font-medium text-strong">{props.name}</p>
            <p className="truncate font-mono text-label text-subtle">@{props.login} · from GitHub</p>
          </div>
        </div>
        <div>
          <label htmlFor="ob-headline" className="text-label text-subtle">
            Role in one line (optional)
          </label>
          <input
            id="ob-headline"
            className={input}
            maxLength={120}
            value={headline}
            placeholder="e.g. Frontend, likes design systems"
            onChange={(e) => setHeadline(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ob-tz" className="text-label text-subtle">
            Timezone{' '}
            {timezone === detected && <span className="text-faint">· detected from this browser</span>}
          </label>
          <select id="ob-tz" className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {(zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ob-interests" className="text-label text-subtle">
            Interests, comma-separated (optional)
          </label>
          <input
            id="ob-interests"
            className={input}
            value={interests}
            placeholder="e.g. developer tools, climate, games"
            onChange={(e) => setInterests(e.target.value)}
          />
        </div>
        {save.isError && (
          <p role="alert" className="text-label text-danger">
            Couldn't save your profile: {save.error.message}. Nothing was lost; try again.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Continue to skills
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ----------------------------- step 2 ----------------------------- */

function SkillsStep(props: { wid: string; uid: string; back: () => void; next: () => void }) {
  const importer = useImportSkills(props.wid, props.uid);
  const skills = useQuery({
    queryKey: qk('memberSkills', { wid: props.wid, uid: props.uid }),
    queryFn: () => api('memberSkills', { params: { wid: props.wid, uid: props.uid } }),
    // Fallback while importing: pick up new skills even without WS progress.
    refetchInterval: importer.importing ? 4000 : false,
  });

  return (
    <div className="space-y-4">
      <Card>
        <SkillImportPanel importer={importer} skillCount={skills.data?.length ?? 0} />
      </Card>
      <Card>
        <h2 className="mb-4 text-body-lg font-medium text-strong">Review your skills</h2>
        {skills.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading skills">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-sm bg-raised" />
            ))}
          </div>
        ) : skills.isError ? (
          <ErrorBox what="your skills" error={skills.error} onRetry={() => void skills.refetch()} />
        ) : (
          <SkillReview
            wid={props.wid}
            uid={props.uid}
            skills={skills.data}
            editable
            empty="No skills yet. Import from GitHub above, or add them by hand below."
          />
        )}
      </Card>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={props.back}>
          Back
        </Button>
        <Button variant="primary" onClick={props.next}>
          Continue to availability
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------- step 3 ----------------------------- */

function SlugTags(props: {
  label: string;
  slugs: string[];
  onChange: (slugs: string[]) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <SkillPicker
        label={props.label}
        exclude={new Set(props.slugs)}
        busy={props.busy || props.slugs.length >= 10}
        placeholder={props.slugs.length >= 10 ? 'Up to 10' : undefined}
        onPick={(s) => props.onChange([...props.slugs, s.slug])}
      />
      {props.slugs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={props.label}>
          {props.slugs.map((slug) => (
            <li key={slug}>
              <button
                type="button"
                disabled={props.busy}
                aria-label={`Remove ${slug} from ${props.label.toLowerCase()}`}
                onClick={() => props.onChange(props.slugs.filter((x) => x !== slug))}
                className="inline-flex h-control-sm items-center gap-1.5 rounded-full border border-border px-2.5 text-label text-default hover:bg-hover"
              >
                <span className="font-mono">{slug}</span>
                <span aria-hidden className="text-subtle">
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

function AvailabilityStep(props: {
  wid: string;
  uid: string;
  profile: MemberProfile;
  back: () => void;
  done: () => void;
}) {
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid: props.wid }),
    queryFn: () => api('getWorkspace', { params: { wid: props.wid } }),
  });
  const prefs = useProfileSave(props.wid, props.uid);
  const p = prefs.data ?? props.profile;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-body-lg font-medium text-strong">When are you around?</h2>
        <p className="mb-4 text-body text-muted">
          Mark when you'll sleep or be away. Hakit only plans work into your available hours.
        </p>
        {workspace.isPending ? (
          <div
            className="h-40 animate-pulse rounded-sm bg-raised"
            aria-busy="true"
            aria-label="Loading event window"
          />
        ) : workspace.isError ? (
          <ErrorBox
            what="the event window"
            error={workspace.error}
            onRetry={() => void workspace.refetch()}
          />
        ) : (
          <AvailabilityEditor
            wid={props.wid}
            uid={props.uid}
            profile={p}
            event={{
              start: Date.parse(workspace.data.startsAt ?? workspace.data.createdAt),
              end: Date.parse(workspace.data.deadlineAt),
            }}
            editable
            saveLabel="Save and finish"
            onSaved={props.done}
          />
        )}
      </Card>
      <Card className="space-y-4">
        <div>
          <h2 className="text-body-lg font-medium text-strong">Preferences</h2>
          <p className="text-body text-muted">
            The assignment engine uses these as soft preferences, never as hard rules. Saved as you go.
          </p>
        </div>
        <SlugTags
          label="Want to learn"
          slugs={p.learningGoals}
          busy={prefs.isPending}
          onChange={(learningGoals) => prefs.mutate({ learningGoals })}
        />
        <SlugTags
          label="Prefer to avoid"
          slugs={p.avoid}
          busy={prefs.isPending}
          onChange={(avoid) => prefs.mutate({ avoid })}
        />
        {prefs.isError && (
          <p role="alert" className="text-label text-danger">
            Couldn't save preferences: {prefs.error.message}
          </p>
        )}
        {prefs.isSuccess && (
          <p role="status" className="text-label text-subtle">
            Preferences saved
          </p>
        )}
      </Card>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={props.back}>
          Back
        </Button>
        <Button variant="ghost" onClick={props.done}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------- page ----------------------------- */

export function Onboarding() {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const wid = search.get('wid') ?? me.data?.memberships[0]?.workspaceId ?? '';
  const uid = me.data?.user.id ?? '';
  const profile = useQuery({
    queryKey: qk('getProfile', { wid, uid }),
    queryFn: () => api('getProfile', { params: { wid, uid } }),
    enabled: !!wid && !!uid,
  });
  const invalidate = useInvalidateMember();
  const finish = useMutation({
    mutationFn: () => api('updateProfile', { params: { wid, uid }, body: { completeOnboarding: true } }),
    onSuccess: () => {
      invalidate(wid, uid);
      navigate(`/w/${wid}/mc`);
    },
  });
  const stepParam = search.get('step');
  const step: Step = (STEPS as readonly string[]).includes(stepParam ?? '') ? (stepParam as Step) : 'profile';
  const index = STEPS.indexOf(step);
  const go = (s: Step) => {
    const next = new URLSearchParams(search);
    next.set('step', s);
    if (wid) next.set('wid', wid);
    setSearch(next);
    window.scrollTo({ top: 0 });
  };

  if (me.isError && isUnauthorized(me.error))
    return (
      <Frame>
        <Card>
          <h1 className="text-title font-medium text-strong">Sign in to set up your profile</h1>
          <a
            href={`${API_PREFIX}/auth/github/login?next=${encodeURIComponent(`/onboarding?${search}`)}`}
            className="mt-4 inline-flex h-control-lg items-center rounded-sm bg-accent-500 px-4 text-body font-medium text-strong hover:bg-accent-400"
          >
            Continue with GitHub
          </a>
        </Card>
      </Frame>
    );
  const error = me.error ?? profile.error;
  if (error)
    return (
      <Frame>
        <ErrorBox
          what="your profile"
          error={error}
          onRetry={() => {
            void me.refetch();
            void profile.refetch();
          }}
        />
      </Frame>
    );
  if (me.data && !wid)
    return (
      <Frame>
        <Card>
          <h1 className="text-title font-medium text-strong">You're not on a team yet</h1>
          <p className="mt-2 text-body text-muted">
            Ask a teammate for their invite link (it looks like <span className="font-mono">/j/ABC123</span>)
            and open it to join.
          </p>
        </Card>
      </Frame>
    );
  if (!me.data || !profile.data)
    return (
      <Frame>
        <div className="space-y-4" aria-busy="true" aria-label="Loading onboarding">
          <div className="h-6 w-64 animate-pulse rounded-sm bg-raised" />
          <div className="h-72 animate-pulse rounded-md border border-border bg-surface" />
        </div>
      </Frame>
    );

  const user = me.data.user;
  const workspaceName = me.data.memberships.find((m) => m.workspaceId === wid)?.workspaceName;
  const done = () => finish.mutate();

  return (
    <Frame wide={step !== 'profile'}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="font-display text-display-sm text-strong">
            {index === 0 ? 'Set up your profile' : index === 1 ? 'Your skills' : 'Availability & preferences'}
          </h1>
          <span className="text-body text-subtle">
            Step {index + 1} of 3{workspaceName && ` · joining ${workspaceName}`}
          </span>
          {profile.data.onboardingCompletedAt && (
            <Link to={`/w/${wid}/mc`} className="ml-auto rounded-xs text-body text-muted hover:text-strong">
              Already set up · go to workspace
            </Link>
          )}
        </div>
        <StepDots steps={STEP_LABEL} current={index} />
      </div>

      {step === 'profile' && (
        <ProfileStep
          wid={wid}
          uid={uid}
          profile={profile.data}
          name={user.name ?? user.githubLogin}
          login={user.githubLogin}
          avatarUrl={user.avatarUrl}
          next={() => go('skills')}
        />
      )}
      {step === 'skills' && (
        <SkillsStep wid={wid} uid={uid} back={() => go('profile')} next={() => go('availability')} />
      )}
      {step === 'availability' && (
        <AvailabilityStep wid={wid} uid={uid} profile={profile.data} back={() => go('skills')} done={done} />
      )}
      {finish.isError && (
        <p role="alert" className="text-label text-danger">
          Couldn't finish setup ({finish.error.message}).{' '}
          <Link to={`/w/${wid}/mc`} className="underline hover:text-strong">
            Go to the workspace anyway
          </Link>
        </p>
      )}
    </Frame>
  );
}
