/**
 * S4 Member profile (DESIGN §8, T-208). Header: avatar, name, GitHub handle, ≈ available hours, current task.
 * Tabs: Skills (confirmed / inferred / learning) · Evidence · Availability · Assignments · Agents.
 * Editable only by the member themself; everyone else gets the same view read-only.
 */
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ids } from '@hakit/contracts/fixtures';
import type { Assignment, MemberSkill, TaskStatus } from '@hakit/contracts';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useProjectSocket } from '../lib/ws';
import { AGENT_NAME, SessionStatusPill, toolSummary } from './agents/meta';
import { ago, fmtHours, useNow } from './mission-control/shared';
import { EmptyBox, ErrorBox, PageHeader, Pill, TaskLinkChip } from './page-states';
import { AvailabilityEditor } from './people/AvailabilityEditor';
import { EvidenceList, SkillReview, isInferred } from './people/SkillReview';
import { CATEGORY_LABEL, Card, PersonAvatar, Tabs, isNotFound, tabPanelProps } from './people/shared';
import { STATUS_LABEL, StatusIcon } from './tasks/meta';

/** Until project selection exists (T-302), screens use the fixture project id. */
const pid = ids.project;

const TABS = ['skills', 'evidence', 'availability', 'assignments', 'agents'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  skills: 'Skills',
  evidence: 'Evidence',
  availability: 'Availability',
  assignments: 'Assignments',
  agents: 'Agents',
};

const ASSIGNMENT_LABEL: Record<Assignment['status'], string> = {
  active: 'Assigned',
  proposed: 'Proposed',
  replaced: 'Reassigned',
  rejected: 'Declined',
};

function Skeleton() {
  return (
    <div className="space-y-6 p-6 max-sm:p-4" aria-busy="true" aria-label="Loading member profile">
      <div className="flex items-center gap-4">
        <div className="size-14 animate-pulse rounded-full bg-raised" />
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded-sm bg-raised" />
          <div className="h-4 w-32 animate-pulse rounded-sm bg-raised" />
        </div>
      </div>
      <div className="h-80 animate-pulse rounded-md border border-border bg-surface" />
    </div>
  );
}

function EvidenceTab({ skills }: { skills: MemberSkill[] }) {
  const withEvidence = skills
    .filter((s) => s.evidence.length > 0)
    .sort((a, b) => b.evidence.length - a.evidence.length || b.level - a.level);
  if (withEvidence.length === 0)
    return (
      <EmptyBox message="No GitHub evidence yet. Skills here were added by hand or from completed tasks." />
    );
  return (
    <ul className="divide-y divide-border">
      {withEvidence.map((s) => (
        <li key={s.skill.slug} className="py-3 first:pt-0">
          <p className="mb-1.5 flex flex-wrap items-baseline gap-2 text-body">
            <span className="font-medium text-strong">{s.skill.name}</span>
            <span className="text-label text-subtle">
              {CATEGORY_LABEL[s.skill.category]} · level {s.level} ·{' '}
              {isInferred(s) ? `inferred, ${Math.round(s.confidence * 100)}% confidence` : 'confirmed'}
            </span>
          </p>
          <EvidenceList evidence={s.evidence} />
        </li>
      ))}
    </ul>
  );
}

export function MemberProfile() {
  const { wid = '', uid = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(search.get('tab') ?? '')
    ? (search.get('tab') as Tab)
    : 'skills';
  const now = useNow();
  useProjectSocket(pid);

  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me') });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });
  const profile = useQuery({
    queryKey: qk('getProfile', { wid, uid }),
    queryFn: () => api('getProfile', { params: { wid, uid } }),
  });
  const skills = useQuery({
    queryKey: qk('memberSkills', { wid, uid }),
    queryFn: () => api('memberSkills', { params: { wid, uid } }),
  });
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });
  const board = useQuery({
    queryKey: qk('getBoard', { pid }),
    queryFn: () => api('getBoard', { params: { pid } }),
  });
  const sessions = useQuery({
    queryKey: qk('listAgentSessions', { pid }),
    queryFn: () => api('listAgentSessions', { params: { pid } }),
  });

  const member = members.data?.find((m) => m.user.id === uid);
  const error = members.error ?? profile.error;
  if (error || (members.data && !member))
    return (
      <div className="space-y-4 p-6 max-sm:p-4">
        <Link to={`/w/${wid}/team`} className="rounded-xs text-body text-muted hover:text-strong">
          ← Team
        </Link>
        {error && !isNotFound(error) ? (
          <ErrorBox
            what="this profile"
            error={error}
            onRetry={() => {
              void members.refetch();
              void profile.refetch();
            }}
          />
        ) : (
          <EmptyBox message="This person isn't a member of this workspace." />
        )}
      </div>
    );
  if (!member || !profile.data) return <Skeleton />;

  const p = profile.data;
  const isMe = me.data?.user.id === uid;
  const name = member.user.name ?? member.user.githubLogin;
  const tasks = new Map((board.data?.tasks ?? []).map((t) => [t.id, t]));
  const current = member.currentTaskId ? tasks.get(member.currentTaskId) : undefined;
  const assignments = (board.data?.assignments ?? [])
    .filter((a) => a.userId === uid)
    .sort(
      (a, b) =>
        (a.status === 'active' ? -1 : 0) - (b.status === 'active' ? -1 : 0) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const mySessions = (sessions.data ?? []).filter((s) => s.userId === uid);
  const learning = p.learningGoals;
  const skillList = skills.data ?? [];

  const panel = (id: Tab, body: React.ReactNode) =>
    tab === id ? (
      <div
        {...tabPanelProps('profile', id)}
        className="rounded-md border border-border bg-surface p-5 max-sm:p-4"
      >
        {body}
      </div>
    ) : null;

  return (
    <div className="space-y-6 p-6 max-sm:p-4">
      <Link to={`/w/${wid}/team?tab=members`} className="rounded-xs text-body text-muted hover:text-strong">
        ← Team
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <PersonAvatar
          name={name}
          avatarUrl={member.user.avatarUrl}
          colorIndex={member.colorIndex}
          className="size-14 text-title"
          decorative
        />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={name}
            subtitle={
              <>
                <a
                  href={`https://github.com/${member.user.githubLogin}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xs font-mono hover:text-strong"
                >
                  @{member.user.githubLogin}
                </a>
                {member.role === 'owner' && ' · workspace owner'}
                {p.headline && ` · ${p.headline}`}
              </>
            }
          >
            {isMe && <Pill tone="accent">You</Pill>}
          </PageHeader>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Card className="py-3">
          <dt className="text-label text-subtle">Available (self-reported)</dt>
          <dd className="mt-1 text-title text-strong">≈ {fmtHours(p.availableHours)}</dd>
        </Card>
        <Card className="py-3">
          <dt className="text-label text-subtle">Working on</dt>
          <dd className="mt-1 min-w-0 text-body">
            {current ? (
              <Link
                to={`/w/${wid}/tasks?task=${current.key}`}
                className="flex min-w-0 items-center gap-1.5 rounded-xs hover:text-strong"
              >
                <StatusIcon status={current.status} />
                <span className="shrink-0 font-mono text-label text-subtle">{current.key}</span>
                <span className="truncate text-default">{current.title}</span>
              </Link>
            ) : (
              <span className="text-subtle">Nothing in progress</span>
            )}
          </dd>
        </Card>
        <Card className="py-3">
          <dt className="text-label text-subtle">Wants to learn</dt>
          <dd className="mt-1 truncate text-body text-default">
            {learning.length ? learning.join(', ') : <span className="text-subtle">Not set</span>}
          </dd>
        </Card>
      </dl>

      <Tabs
        label="Profile sections"
        idPrefix="profile"
        value={tab}
        onChange={(t) => setSearch(t === 'skills' ? {} : { tab: t }, { replace: true })}
        tabs={TABS.map((t) => ({
          id: t,
          label: TAB_LABEL[t],
          count:
            t === 'skills'
              ? skills.data?.length
              : t === 'assignments'
                ? board.data && assignments.length
                : t === 'agents'
                  ? sessions.data && mySessions.length
                  : undefined,
        }))}
      />

      {panel(
        'skills',
        skills.isPending ? (
          <div
            className="h-48 animate-pulse rounded-sm bg-raised"
            aria-busy="true"
            aria-label="Loading skills"
          />
        ) : skills.isError ? (
          <ErrorBox what="skills" error={skills.error} onRetry={() => void skills.refetch()} />
        ) : (
          <div className="space-y-6">
            <SkillReview
              wid={wid}
              uid={uid}
              skills={skillList}
              editable={isMe}
              empty={
                isMe
                  ? 'No skills yet. Import them from GitHub in onboarding, or add them below.'
                  : `${name} hasn't added any skills yet.`
              }
            />
            {isMe && (
              <p className="text-label text-subtle">
                Want a fresh read of your GitHub?{' '}
                <Link
                  to={`/onboarding?wid=${wid}&step=skills`}
                  className="rounded-xs text-default underline decoration-border-strong underline-offset-2 hover:text-strong"
                >
                  Re-run the skill import
                </Link>
              </p>
            )}
            {(p.interests.length > 0 || p.avoid.length > 0) && (
              <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-label font-medium text-subtle uppercase">Interests</h3>
                  <p className="mt-1 text-body text-default">{p.interests.join(', ') || '—'}</p>
                </div>
                <div>
                  <h3 className="text-label font-medium text-subtle uppercase">Prefers to avoid</h3>
                  <p className="mt-1 text-body text-default">{p.avoid.join(', ') || '—'}</p>
                </div>
              </div>
            )}
          </div>
        ),
      )}

      {panel(
        'evidence',
        skills.isPending ? (
          <div
            className="h-48 animate-pulse rounded-sm bg-raised"
            aria-busy="true"
            aria-label="Loading evidence"
          />
        ) : skills.isError ? (
          <ErrorBox what="evidence" error={skills.error} onRetry={() => void skills.refetch()} />
        ) : (
          <EvidenceTab skills={skillList} />
        ),
      )}

      {panel(
        'availability',
        workspace.isPending ? (
          <div
            className="h-48 animate-pulse rounded-sm bg-raised"
            aria-busy="true"
            aria-label="Loading availability"
          />
        ) : workspace.isError ? (
          <ErrorBox
            what="the event window"
            error={workspace.error}
            onRetry={() => void workspace.refetch()}
          />
        ) : (
          <AvailabilityEditor
            // Remount after a save so the draft resets to the server's windows.
            key={p.availability.map((w) => w.start + w.kind).join()}
            wid={wid}
            uid={uid}
            profile={p}
            event={{
              start: Date.parse(workspace.data.startsAt ?? workspace.data.createdAt),
              end: Date.parse(workspace.data.deadlineAt),
            }}
            editable={isMe}
          />
        ),
      )}

      {panel(
        'assignments',
        board.isPending ? (
          <div
            className="h-48 animate-pulse rounded-sm bg-raised"
            aria-busy="true"
            aria-label="Loading assignments"
          />
        ) : board.isError ? (
          <ErrorBox what="assignments" error={board.error} onRetry={() => void board.refetch()} />
        ) : assignments.length === 0 ? (
          <EmptyBox message={`No tasks assigned to ${isMe ? 'you' : name} yet.`} />
        ) : (
          <ul className="divide-y divide-border">
            {assignments.map((a) => {
              const t = tasks.get(a.taskId);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  {t && <StatusIcon status={t.status} />}
                  <Link
                    to={`/w/${wid}/tasks?task=${t?.key ?? ''}`}
                    className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-xs hover:text-strong"
                  >
                    <span className="shrink-0 font-mono text-label text-subtle">{t?.key ?? 'Task'}</span>
                    <span className="truncate text-body text-default">{t?.title ?? 'Removed task'}</span>
                  </Link>
                  {t && (
                    <span className="text-label text-subtle">
                      {STATUS_LABEL[t.status as TaskStatus]} · ≈{fmtHours(t.estimateHours)}
                    </span>
                  )}
                  <Pill tone={a.status === 'active' ? 'accent' : 'muted'}>{ASSIGNMENT_LABEL[a.status]}</Pill>
                </li>
              );
            })}
          </ul>
        ),
      )}

      {panel(
        'agents',
        sessions.isPending ? (
          <div
            className="h-48 animate-pulse rounded-sm bg-raised"
            aria-busy="true"
            aria-label="Loading agent sessions"
          />
        ) : sessions.isError ? (
          <ErrorBox what="agent sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : mySessions.length === 0 ? (
          <EmptyBox
            message={
              isMe
                ? 'No agent sessions. Agent telemetry is opt-in: create a token in Settings to connect Claude Code.'
                : `${name} hasn't connected a coding agent.`
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {mySessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <span className="text-body font-medium text-strong">{AGENT_NAME[s.agent]}</span>
                <SessionStatusPill status={s.status} />
                <TaskLinkChip task={s.taskId ? tasks.get(s.taskId) : undefined} linkKind={s.linkKind} />
                <span className="min-w-0 truncate font-mono text-label text-muted">
                  {s.repoFullName ?? 'Unknown repo'}
                  {s.branch && ` · ${s.branch}`}
                </span>
                <span className="ml-auto text-label text-subtle">
                  {toolSummary(s.summary.toolCounts)} · {ago(s.lastEventAt, now)}
                </span>
              </li>
            ))}
          </ul>
        ),
      )}
      {tab === 'agents' && (
        <p className="text-label text-subtle">
          <Link to={`/w/${wid}/agents`} className="rounded-xs hover:text-strong">
            All agent sessions →
          </Link>
        </p>
      )}
    </div>
  );
}
