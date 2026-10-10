/** Screen stubs S1–S14 (DESIGN §8). Each FE task replaces one export with a real screen in its own file. */
import { useParams } from 'react-router';
import type { MissionControlSnapshot } from '@hakit/contracts';
import { ids } from '@hakit/contracts/fixtures';
import { Button } from '@hakit/ui';
import { Placeholder } from './Placeholder';
import { useProjectSocket } from '../lib/ws';

/** Until project selection exists (T-302), screens use the fixture project id. */
const useProjectId = () => ids.project;
const useWid = () => useParams().wid ?? '';

export function Login() {
  return (
    <section className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <p className="text-caption uppercase tracking-wide text-subtle">S1 · T-207</p>
        <h1 className="mt-2 font-display text-display-sm text-strong">hakit</h1>
        <p className="mt-2 text-body-lg text-muted">
          The hackathon OS that knows your team and knows what to build next.
        </p>
        <a href="/api/v1/auth/github/login?next=/" className="mt-6 block">
          <Button variant="primary" size="xl" className="w-full">
            Continue with GitHub
          </Button>
        </a>
        <p className="mt-4 text-caption text-subtle">
          We read your public repos to suggest skills. We never read private code without asking.
        </p>
      </div>
    </section>
  );
}

export function Join() {
  const { code = '' } = useParams();
  return (
    <Placeholder
      screen="S2"
      title="Join team"
      tasks="T-207"
      endpoint="previewInvite"
      args={{ params: { code } }}
    />
  );
}
export function Onboarding() {
  return <Placeholder screen="S1/S3" title="Onboarding & skill import" tasks="T-207, T-208" endpoint="me" />;
}
export function MissionControl() {
  const pid = useProjectId();
  const { state, presence, polling } = useProjectSocket(pid);
  return (
    <>
      <p className="px-6 pt-4 text-caption text-subtle" role="status" aria-live="polite">
        {state === 'open' ? `Live · ${presence.length} online` : polling ? 'Updating every 10 seconds · Reconnecting' : 'Reconnecting…'}
      </p>
      <Placeholder
        screen="S11"
        title="Mission Control"
        tasks="T-106, T-503"
        endpoint="missionControl"
        args={{ params: { pid } }}
        summarize={(d) => {
          const s = d as MissionControlSnapshot;
          return `${s.health.status}: ${s.health.reason} · ${s.progress.tasksDone}/${s.progress.tasksTotal} tasks · ${s.openRecommendations.length} recommendation(s)`;
        }}
      />
    </>
  );
}
export function Plan() {
  return (
    <Placeholder
      screen="S6–S9"
      title="Plan: ideas → constraints → plan → assignment"
      tasks="T-302, T-304, T-307, T-311"
      endpoint="getPlan"
      args={{ params: { pid: useProjectId(), planId: ids.plan } }}
    />
  );
}
export function Tasks() {
  return (
    <Placeholder
      screen="S10"
      title="Tasks"
      tasks="T-312"
      endpoint="getBoard"
      args={{ params: { pid: useProjectId() } }}
    />
  );
}
export function Team() {
  return (
    <Placeholder
      screen="S5"
      title="Team capability"
      tasks="T-209"
      endpoint="teamCapability"
      args={{ params: { wid: useWid() } }}
    />
  );
}
export function MemberProfile() {
  const { uid = '' } = useParams();
  return (
    <Placeholder
      screen="S4"
      title="Member profile"
      tasks="T-208"
      endpoint="memberSkills"
      args={{ params: { wid: useWid(), uid } }}
    />
  );
}
export function Code() {
  return (
    <Placeholder
      screen="S12"
      title="Code activity"
      tasks="T-407"
      endpoint="listActivity"
      args={{ params: { pid: useProjectId() } }}
    />
  );
}
export function Agents() {
  return (
    <Placeholder
      screen="S13"
      title="Coding agents"
      tasks="T-604"
      endpoint="listAgentSessions"
      args={{ params: { pid: useProjectId() } }}
    />
  );
}
export function Settings() {
  return (
    <Placeholder screen="S14" title="Settings & integrations" tasks="T-601, T-402" endpoint="aiStatus" />
  );
}
export function UiGallery() {
  return (
    <section className="space-y-6 p-6">
      <p className="text-caption uppercase tracking-wide text-subtle">/_ui · T-102, T-103</p>
      <h1 className="font-display text-display-sm text-strong">Component gallery</h1>
      <div className="flex flex-wrap items-center gap-2">
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
        <Button variant="primary" loading>
          loading
        </Button>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="size-6 rounded-full" style={{ background: `var(--color-member-${i})` }} />
        ))}
      </div>
    </section>
  );
}
