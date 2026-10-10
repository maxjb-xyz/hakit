/**
<<<<<<< HEAD
 * S5 Team (DESIGN §8). One card per member: who they are, whether they're online, and what they're on.
 * Uses FAKE data from mocks/team.ts + mocks/plan.ts until the backend is connected.
 */
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Member, Task } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { MOCK_NOW } from '../mocks/fake';
import { fetchBoard } from '../mocks/plan';
import { fetchMembers, fetchTeamLanes, type TeamLane } from '../mocks/team';
import { MeasuredBar, ago, fmtHours, memberName, minutesSince } from './mission-control/shared';
import { MemberAvatar } from './tasks/meta';
import { EmptyBox, ErrorBox, LoadingBlocks, MockChip, PageHeader, Pill } from './page-states';

/* ----------------------------- online status ----------------------------- */

type Presence = 'online' | 'idle' | 'away';

/** Someone counts as "online" if they did something in the last 30 minutes. */
const ONLINE_MINUTES = 30;

/** Works out online status from the lane fields the backend sends (there's no presence endpoint). */
function presenceOf(lane: TeamLane | undefined, now: number): Presence {
  if (!lane || !lane.availableNow) return 'away';
  const mins = minutesSince(lane.lastActivityAt, now);
  return mins !== null && mins <= ONLINE_MINUTES ? 'online' : 'idle';
}

const PRESENCE: Record<Presence, { label: string; dot: string }> = {
  online: { label: 'Online', dot: 'bg-success' },
  idle: { label: 'Idle', dot: 'bg-warning' },
  away: { label: 'Away', dot: 'bg-disabled' },
};

/* ----------------------------- page ----------------------------- */

export function Team() {
  // TODO: replace with api call. queryFns become `() => api('listMembers', …)`, `() => api('missionControl', …)`
  // and `() => api('getBoard', …)`. Also swap MOCK_NOW for `useNow()` from mission-control/shared.
  const members = useQuery({ queryKey: ['mock', 'members'], queryFn: fetchMembers });
  const lanes = useQuery({ queryKey: ['mock', 'lanes'], queryFn: fetchTeamLanes });
  const board = useQuery({ queryKey: ['mock', 'board'], queryFn: fetchBoard });
  const now = MOCK_NOW;

  const list = members.data ?? [];
  const laneOf = (m: Member) => lanes.data?.find((l) => l.userId === m.user.id);
  const onlineCount = list.filter((m) => presenceOf(laneOf(m), now) === 'online').length;
  const totalHours = list.reduce((sum, m) => sum + m.profile.availableHours, 0);

  return (
    <div className="space-y-4 p-6 max-sm:p-4">
      <PageHeader
        title="Team"
        subtitle={
          members.data
            ? `${list.length} members · ≈ ${fmtHours(totalHours)} available (estimated)`
            : undefined
        }
      >
        {members.data && (
          <Pill tone="success">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            {onlineCount} online
          </Pill>
        )}
        <MockChip />
      </PageHeader>

      {members.isError && (
        <ErrorBox what="team members" error={members.error} onRetry={() => void members.refetch()} />
      )}

      {members.isPending ? (
        <LoadingBlocks label="Loading team" />
      ) : list.length === 0 ? (
        <EmptyBox message="No one has joined yet. Share your invite link from Settings to add teammates." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <MemberCard
              key={m.user.id}
              member={m}
              lane={laneOf(m)}
              currentTask={board.data?.tasks.find((t) => t.id === m.currentTaskId)}
              now={now}
            />
          ))}
        </ul>
      )}
=======
 * S5 Team capability (DESIGN §8, T-209). Matrix of members × categories from each member's skills,
 * coverage + gaps + overlaps from `teamCapability` (engine-computed), and an availability stack built
 * from self-reported profile windows. Tabs: Capability (default) · Availability · Members.
 */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ids } from '@hakit/contracts/fixtures';
import type { CoverageLabel, Member, MemberSkill, SkillCategory, TeamCapability } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { useNow } from './mission-control/shared';

const CATEGORIES: { key: SkillCategory; label: string }[] = [
  { key: 'frontend', label: 'Frontend' },
  { key: 'backend', label: 'Backend' },
  { key: 'data', label: 'Data' },
  { key: 'ml_ai', label: 'ML' },
  { key: 'infra_devops', label: 'Infra' },
  { key: 'design_ux', label: 'Design' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'hardware_embedded', label: 'Hardware' },
];
const catLabel = (c: SkillCategory) =>
  CATEGORIES.find((x) => x.key === c)?.label ?? c.replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase());

const COVERAGE: Record<CoverageLabel, { text: string; tone: string; bar: string }> = {
  strong: { text: 'Strong', tone: 'text-muted', bar: 'bg-level-4' },
  adequate: { text: 'Adequate', tone: 'text-muted', bar: 'bg-level-4' },
  thin: { text: 'Thin', tone: 'text-warning', bar: 'bg-warning' },
  gap: { text: 'Gap', tone: 'text-danger', bar: 'bg-danger' },
};

const LEVEL_BG = ['', 'bg-level-1', 'bg-level-2', 'bg-level-3', 'bg-level-4', 'bg-level-5'];

const TABS = ['capability', 'availability', 'members'] as const;
type Tab = (typeof TABS)[number];

const nameOf = (m: Member) => m.user.name ?? m.user.githubLogin;
const initials = (m: Member) =>
  nameOf(m)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const prettySlug = (slug: string) =>
  slug
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

function Avatar({ m }: { m: Member }) {
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold text-on-light"
      style={{ background: `var(--color-member-${m.colorIndex})` }}
    >
      {initials(m)}
    </span>
  );
}

/** Small dashed diamond marking AI-originated text (handoff principle 4). */
function AiGlyph() {
  return (
    <span
      aria-hidden
      className="inline-block size-2 rotate-45 border-(length:--border-width-emphasis) border-dashed border-ai"
    />
  );
}

function SectionHead(props: { title: string; meta?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-body-lg font-medium text-strong">{props.title}</h2>
      {props.meta && <span className="text-body text-subtle">{props.meta}</span>}
      {props.right && <div className="ml-auto">{props.right}</div>}
>>>>>>> 03cec4370982ad691ab44c2b85c1fdb07daf8a7b
    </div>
  );
}

<<<<<<< HEAD
/* ----------------------------- one member ----------------------------- */

function MemberCard(props: {
  member: Member;
  lane: TeamLane | undefined;
  currentTask: Task | undefined;
  now: number;
}) {
  const { wid = '' } = useParams();
  const { member: m, lane } = props;
  const presence = PRESENCE[presenceOf(lane, props.now)];
  const assigned = lane?.assignedHours ?? 0;
  const available = lane?.availableHours ?? m.profile.availableHours;
  const overloaded = assigned > available;
  const agentCount = lane?.agentSessions.filter((s) => s.status !== 'ended').length ?? 0;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      {/* Who + online status */}
      <div className="flex items-start gap-3">
        <span className="relative">
          <MemberAvatar member={m} className="size-10 text-body" />
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface',
              presence.dot,
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/w/${wid}/team/${m.user.id}`}
              className="truncate text-body font-medium text-strong hover:underline"
            >
              {memberName(m)}
            </Link>
            <Pill tone={m.role === 'owner' ? 'accent' : 'muted'}>
              {m.role === 'owner' ? 'Owner' : 'Member'}
            </Pill>
          </div>
          <p className="truncate text-label text-subtle">
            @{m.user.githubLogin}
            {m.profile.headline && ` · ${m.profile.headline}`}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-label text-muted">
          <span aria-hidden className={cn('size-1.5 rounded-full', presence.dot)} />
          {presence.label}
        </span>
      </div>

      {/* What they're working on */}
      <div>
        <p className="text-caption uppercase tracking-wide text-subtle">Working on</p>
        {props.currentTask ? (
          <Link
            to={`/w/${wid}/tasks?task=${props.currentTask.key}`}
            className="flex min-w-0 items-baseline gap-1.5 text-body hover:text-strong"
          >
            <span className="shrink-0 font-mono text-label text-subtle">{props.currentTask.key}</span>
            <span className="truncate text-default">{props.currentTask.title}</span>
          </Link>
        ) : (
          <p className="text-body text-subtle">Nothing right now</p>
        )}
        <p className="text-label text-subtle">
          Last active {ago(lane?.lastActivityAt ?? null, props.now)}
          {agentCount > 0 && ` · ${agentCount} agent session${agentCount === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* Workload */}
      <div className="space-y-1">
        <div className="flex justify-between text-label">
          <span className="text-subtle">Assigned</span>
          <span className={overloaded ? 'text-danger' : 'text-muted'}>
            {fmtHours(assigned)} of ≈ {fmtHours(available)}
            {overloaded && ' · overloaded'}
          </span>
        </div>
        <MeasuredBar
          value={available ? assigned / available : 0}
          label={`${memberName(m)}: ${assigned} of ${available} hours assigned`}
          tone={overloaded ? 'danger' : 'accent'}
        />
      </div>

      {/* Top skills: inferred ones (not yet confirmed by the member) get a dashed border */}
      {m.topSkills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Top skills">
          {m.topSkills.map((s) => (
            <li key={s.slug}>
              <Pill
                className={cn(!s.confirmed && 'border-dashed')}
                title={s.confirmed ? 'Confirmed by the member' : 'Inferred from GitHub, not confirmed yet'}
              >
                {s.slug}
                <span className="text-subtle">
                  {s.level}/5{!s.confirmed && ' · inferred'}
                </span>
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
=======
/* --------------------------------- matrix --------------------------------- */

type Cell = { level: number; inferred: boolean; skills: MemberSkill[] };

function buildCells(skills: MemberSkill[] | undefined): Map<SkillCategory, Cell> {
  const out = new Map<SkillCategory, Cell>();
  for (const s of skills ?? []) {
    const cat = s.skill.category;
    const cur = out.get(cat) ?? { level: 0, inferred: false, skills: [] };
    cur.skills.push(s);
    if (s.level > cur.level) {
      cur.level = s.level;
      cur.inferred = s.source === 'inferred';
    } else if (s.level === cur.level && s.source !== 'inferred') {
      cur.inferred = false;
    }
    out.set(cat, cur);
  }
  return out;
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-label text-subtle">
      <span className="flex items-center gap-1">
        1
        {LEVEL_BG.slice(1).map((bg) => (
          <span key={bg} aria-hidden className={cn('size-3 rounded-xs', bg)} />
        ))}
        5
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-xs border border-dashed border-level-4" />
        Inferred
      </span>
    </div>
  );
}

/** Own skills only: confirm an inferred level or set a different one (`upsertSkill` is /me). */
function SkillControls({ wid, uid, skill }: { wid: string; uid: string; skill: MemberSkill }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (level: number) =>
      api('upsertSkill', { params: { slug: skill.skill.slug }, body: { level, confirmed: true } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk('memberSkills', { wid, uid }) }),
  });
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {skill.source === 'inferred' && (
        <Button
          size="sm"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => save.mutate(skill.level)}
        >
          Confirm level {skill.level}
        </Button>
      )}
      <span className="text-label text-subtle">{skill.source === 'inferred' ? 'or set' : 'Adjust'}</span>
      {[1, 2, 3, 4, 5].map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === skill.level && skill.source !== 'inferred'}
          disabled={save.isPending}
          onClick={() => save.mutate(l)}
          className={cn(
            'grid size-6 place-items-center rounded-xs border text-label',
            l === skill.level
              ? 'border-default text-strong'
              : 'border-border-strong text-subtle hover:text-strong',
          )}
        >
          {l}
        </button>
      ))}
      {save.isSuccess && (
        <span className="text-label text-subtle" role="status">
          Saved
        </span>
      )}
      {save.isError && (
        <span className="text-label text-danger" role="alert">
          {save.error.message}
        </span>
      )}
    </span>
  );
}

function CapabilityMatrix(props: {
  members: Member[];
  cells: Map<string, Map<SkillCategory, Cell>>;
  cap: TeamCapability;
  skillsLoading: boolean;
  /** Highest level the current plan's tasks ask for, per category. */
  needs: Map<SkillCategory, number>;
  meId: string | null;
  wid: string;
}) {
  const [open, setOpen] = useState<{ uid: string; cat: SkillCategory } | null>(null);
  const coverage = new Map(props.cap.categories.map((c) => [c.category, c]));
  const confirmed = props.members.filter((m) => m.topSkills.some((s) => s.confirmed)).length;
  const selected = open && props.cells.get(open.uid)?.get(open.cat);
  const selectedMember = open && props.members.find((m) => m.user.id === open.uid);
  // Hide categories nobody has, nothing needs and the engine didn't flag; say so below the grid.
  const relevant = (c: SkillCategory) =>
    props.needs.has(c) ||
    coverage.get(c)?.label === 'gap' ||
    props.members.some((m) => props.cells.get(m.user.id)?.has(c));
  const shown = props.skillsLoading ? CATEGORIES : CATEGORIES.filter((c) => relevant(c.key));
  const hidden = CATEGORIES.filter((c) => !shown.includes(c));
  const teamMax = (c: SkillCategory) =>
    Math.max(0, ...props.members.map((m) => props.cells.get(m.user.id)?.get(c)?.level ?? 0));
  const cols = { gridTemplateColumns: `minmax(120px,150px) repeat(${shown.length}, minmax(36px,1fr))` };

  return (
    <section aria-labelledby="cap-h">
      <SectionHead
        title="Capability"
        meta={`from GitHub repos, ${confirmed} of ${props.members.length} profiles confirmed`}
        right={<Legend />}
      />
      <div className="overflow-x-auto">
        <div role="table" aria-label="Skill level by member and category" className="min-w-table-min">
          <div role="row" className="grid gap-1 pb-1" style={cols}>
            <span role="columnheader">
              <span className="sr-only">Member</span>
            </span>
            {shown.map((c) => (
              <span key={c.key} role="columnheader" className="truncate text-center text-label text-subtle">
                {c.label}
              </span>
            ))}
          </div>
          {props.members.map((m) => {
            const row = props.cells.get(m.user.id);
            return (
              <div key={m.user.id} role="row" className="grid gap-1 py-0.5" style={cols}>
                <span role="rowheader" className="flex min-w-0 items-center gap-2">
                  <Avatar m={m} />
                  <Link
                    to={m.user.id}
                    className="truncate rounded-xs text-body text-default hover:text-strong"
                  >
                    {nameOf(m)}
                  </Link>
                </span>
                {shown.map((c) => {
                  const cell = row?.get(c.key);
                  const isOpen = open?.uid === m.user.id && open.cat === c.key;
                  if (!row && props.skillsLoading)
                    return (
                      <span key={c.key} role="cell" className="h-10 animate-pulse rounded-xs bg-raised" />
                    );
                  if (!cell)
                    return (
                      <span key={c.key} role="cell" className="h-10 rounded-xs bg-surface">
                        <span className="sr-only">none</span>
                      </span>
                    );
                  return (
                    <span key={c.key} role="cell" className="contents">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${nameOf(m)}, ${c.label}: level ${cell.level}${cell.inferred ? ', inferred' : ''}. Show evidence`}
                        onClick={() => setOpen(isOpen ? null : { uid: m.user.id, cat: c.key })}
                        className={cn(
                          'h-10 rounded-xs border text-body tabular-nums transition-colors duration-(--duration-instant)',
                          cell.inferred
                            ? 'border-dashed border-level-4 bg-transparent text-muted'
                            : cn(LEVEL_BG[cell.level], 'border-transparent'),
                          !cell.inferred && (cell.level >= 5 ? 'text-on-light' : 'text-default'),
                          'hover:border-disabled',
                          isOpen && 'border-default',
                        )}
                      >
                        {cell.inferred ? `≈${cell.level}` : cell.level}
                      </button>
                    </span>
                  );
                })}
              </div>
            );
          })}
          <div role="row" className="mt-3 grid gap-1" style={cols}>
            <span role="rowheader" className="text-body text-subtle">
              Coverage
            </span>
            {shown.map((c) => {
              const cov = coverage.get(c.key);
              const st = cov ? COVERAGE[cov.label] : null;
              const need = props.needs.get(c.key);
              const short = need !== undefined && teamMax(c.key) < need;
              return (
                <span
                  key={c.key}
                  role="cell"
                  className="flex flex-col items-stretch gap-1.5"
                  title={[
                    cov
                      ? `Coverage ${cov.coverage.toFixed(1)} of 5, bus factor ${cov.busFactor}`
                      : 'Not scored yet',
                    need !== undefined ? `plan needs level ${need}, team best ${teamMax(c.key)}` : '',
                  ]
                    .filter(Boolean)
                    .join('. ')}
                >
                  <span
                    className={cn(
                      'relative h-meter rounded-full',
                      cov ? 'bg-raised' : 'border-t border-dashed border-level-4',
                    )}
                  >
                    {cov && st && (
                      <span
                        className={cn('block h-full rounded-full', st.bar)}
                        style={{ width: `${Math.max(8, (cov.coverage / 5) * 100)}%` }}
                      />
                    )}
                    {need !== undefined && (
                      <span
                        aria-hidden
                        className={cn('absolute -top-1 h-tick w-px', short ? 'bg-warning' : 'bg-strong')}
                        style={{ left: `${(need / 5) * 100}%` }}
                      />
                    )}
                  </span>
                  <span className={cn('truncate text-center text-label', st?.tone ?? 'text-faint')}>
                    {st?.text ?? 'Not scored'}
                  </span>
                  {need !== undefined && (
                    <span
                      className={cn(
                        'truncate text-center text-caption',
                        short ? 'text-warning' : 'text-subtle',
                      )}
                    >
                      needs {need}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {hidden.length > 0 && (
        <p className="mt-3 text-label text-subtle">
          Hidden: {hidden.map((c) => c.label).join(', ')}. No one has these skills and the plan doesn't need
          them.
        </p>
      )}
      <p className="mt-1 flex items-center gap-1.5 text-label text-subtle">
        <span aria-hidden className="inline-block h-tick w-px bg-strong" /> level the current plan needs
      </p>

      {selected && selectedMember && (
        <div
          className="mt-4 rounded-md border border-border bg-surface p-4"
          role="region"
          aria-label="Evidence"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-body font-medium text-strong">
              {nameOf(selectedMember)} · {catLabel(open!.cat)}
            </span>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="ml-auto rounded-xs px-1 text-label text-subtle hover:text-strong"
            >
              Close
            </button>
          </div>
          <ul className="space-y-2">
            {selected.skills.map((s) => (
              <li key={s.skill.id} className="text-body">
                <span className="text-default">{s.skill.name}</span>{' '}
                <span className="text-subtle">
                  level {s.source === 'inferred' ? '≈' : ''}
                  {s.level} ·{' '}
                  {s.source === 'inferred'
                    ? `inferred ${Math.round(s.confidence * 100)}%`
                    : s.source.replace('_', ' ')}
                </span>
                {selectedMember.user.id === props.meId && (
                  <SkillControls wid={props.wid} uid={props.meId} skill={s} />
                )}
                {s.evidence.length > 0 && (
                  <ul className="mt-1 space-y-0.5 border-l border-border pl-3">
                    {s.evidence.map((e) => (
                      <li key={e.id} className="text-label text-subtle">
                        {e.url ? (
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted hover:text-strong"
                          >
                            {e.sourceRef}
                          </a>
                        ) : (
                          <span className="text-muted">{e.sourceRef}</span>
                        )}{' '}
                        {e.summary}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------- availability ------------------------------ */

const STEP_MS = 30 * 60_000;
const BAND_FILL = [
  '--color-level-4',
  '--color-level-3',
  '--color-level-2',
  '--color-level-1',
  '--color-raised',
];

function AvailabilityChart(props: {
  members: Member[];
  start: number;
  end: number;
  now: number;
  totalHours: number;
  tall?: boolean;
}) {
  const { start, end } = props;
  const W = 1000;
  const H = props.tall ? 240 : 120;
  const steps = Math.max(1, Math.ceil((end - start) / STEP_MS));
  const n = props.members.length || 1;

  // 1 if the member reported "available" covering the sample time.
  const awake = props.members.map((m) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const t = start + i * STEP_MS;
      return m.profile.availability.some(
        (w) => w.kind === 'available' && Date.parse(w.start) <= t && t < Date.parse(w.end),
      )
        ? 1
        : 0;
    }),
  );
  const x = (i: number) => (i / steps) * W;
  const y = (v: number) => H - (v / n) * H;
  // Running totals: band k sits on top of bands 0..k-1.
  const tops = awake.map((_, k) =>
    awake[0]!.map((__, i) => awake.slice(0, k + 1).reduce((sum, row) => sum + row[i]!, 0)),
  );
  const bands = awake.map((_, k) => {
    const top = tops[k]!;
    const base = k === 0 ? top.map(() => 0) : tops[k - 1]!;
    const pts = [
      ...top.map((v, i) => `${x(i)},${y(v)}`),
      ...base.map((v, i) => `${x(i)},${y(v)}`).reverse(),
    ].join(' ');
    return { m: props.members[k]!, pts, fill: BAND_FILL[k % BAND_FILL.length]! };
  });

  const nowPct = ((props.now - start) / (end - start)) * 100;
  const nowIdx = Math.round((props.now - start) / STEP_MS);
  const awakeNow = awake.filter((row) => row[nowIdx] === 1).length;
  const pctOf = (iso: string) =>
    Math.min(100, Math.max(0, ((Date.parse(iso) - start) / (end - start)) * 100));
  const ticks = Array.from({ length: 5 }, (_, i) => start + ((end - start) * i) / 4);
  const fmt = (t: number) =>
    new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <section aria-labelledby="avail-h">
      <SectionHead
        title="Availability"
        meta="people awake and working, self-reported"
        right={<span className="text-body text-muted">≈ {Math.round(props.totalHours)}h team total</span>}
      />
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={cn('block w-full', props.tall ? 'h-60' : 'h-30')}
          role="img"
          aria-label={`Stacked availability of ${props.members.length} members from ${fmt(start)} to ${fmt(end)}`}
        >
          {bands.map((b) => (
            <polygon key={b.m.user.id} points={b.pts} style={{ fill: `var(${b.fill})` }}>
              <title>{nameOf(b.m)}</title>
            </polygon>
          ))}
        </svg>
        {nowPct > 0 && nowPct < 100 && (
          <>
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-strong/50"
              style={{ left: `${nowPct}%` }}
            />
            <span
              className="absolute -top-0.5 rounded-xs bg-canvas px-1.5 text-label whitespace-nowrap text-default"
              style={{ left: `${nowPct}%`, transform: nowPct > 85 ? 'translateX(-100%)' : undefined }}
            >
              awake now: {awakeNow} of {props.members.length}
            </span>
          </>
        )}
      </div>
      <div className="mt-2 flex justify-between text-label text-subtle">
        {ticks.map((t) => (
          <span key={t}>{fmt(t)}</span>
        ))}
      </div>
      <ul className="mt-4 space-y-1.5" aria-label="Sleep and away blocks per member">
        {bands.map((b) => (
          <li key={b.m.user.id} className="grid grid-cols-(--grid-skill-row) items-center gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-label text-subtle">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-xs"
                style={{ background: `var(${b.fill})` }}
              />
              <span className="truncate">{nameOf(b.m)}</span>
            </span>
            <span className="relative h-2 rounded-full bg-raised">
              {b.m.profile.availability
                .filter((w) => w.kind !== 'available')
                .map((w) => (
                  <span
                    key={w.start}
                    title={`${w.kind === 'sleep' ? 'Sleep' : 'Away'} ${fmt(Date.parse(w.start))} to ${fmt(Date.parse(w.end))}`}
                    className={cn(
                      'absolute inset-y-0 rounded-full',
                      w.kind === 'sleep' ? 'bg-hatch' : 'border border-dashed border-level-4',
                    )}
                    style={{ left: `${pctOf(w.start)}%`, width: `${pctOf(w.end) - pctOf(w.start)}%` }}
                  >
                    <span className="sr-only">
                      {w.kind} {fmt(Date.parse(w.start))} to {fmt(Date.parse(w.end))}
                    </span>
                  </span>
                ))}
            </span>
            <span className="text-right text-label text-muted">
              {Math.round(b.m.profile.availableHours)}h
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1.5 text-label text-subtle">
        <span aria-hidden className="bg-hatch inline-block h-2 w-4 rounded-full" /> sleep
        <span
          aria-hidden
          className="ml-3 inline-block h-2 w-4 rounded-full border border-dashed border-level-4"
        />{' '}
        away
      </p>
    </section>
  );
}

/* ------------------------------ gaps & overlaps ---------------------------- */

function Callout(props: { kind: 'gap' | 'overlap'; title: string; body: string }) {
  return (
    <li className="rounded-md border border-border bg-surface p-4">
      <p className="flex items-start gap-2.5 text-body font-medium text-strong">
        {props.kind === 'gap' ? (
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-full border-(length:--border-width-emphasis) border-danger"
          />
        ) : (
          <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full bg-level-4" />
        )}
        <span>
          <span className="sr-only">{props.kind === 'gap' ? 'Gap: ' : 'Overlap: '}</span>
          {props.title}
        </span>
      </p>
      <p className="mt-1 pl-5.5 text-body text-subtle">{props.body}</p>
    </li>
  );
}

function SidePanel({ cap, members }: { cap: TeamCapability; members: Member[] }) {
  const byId = new Map(members.map((m) => [m.user.id, m]));
  const thin = cap.categories.filter(
    (c) => c.label === 'thin' && !cap.gaps.some((g) => g.category === c.category),
  );
  const busOne = cap.categories.filter((c) => c.busFactor === 1 && c.label !== 'gap');
  return (
    <aside className="space-y-7">
      {cap.aiSummary && (
        <section className="rounded-md border border-border p-4">
          <p className="mb-1 flex items-center gap-2 text-label text-subtle">
            <AiGlyph /> AI summary
          </p>
          <p className="text-body text-default">{cap.aiSummary}</p>
        </section>
      )}
      <section>
        <SectionHead title="Gaps" meta={String(cap.gaps.length + thin.length)} />
        {cap.gaps.length + thin.length === 0 ? (
          <p className="text-body text-subtle">No category is uncovered.</p>
        ) : (
          <ul className="space-y-3">
            {cap.gaps.map((g) => (
              <Callout
                key={g.category}
                kind="gap"
                title={`No one covers ${catLabel(g.category)}`}
                body={g.note}
              />
            ))}
            {thin.map((c) => (
              <Callout
                key={c.category}
                kind="gap"
                title={`${catLabel(c.category)} is thin`}
                body={`Coverage ${c.coverage.toFixed(1)} of 5 across the team.`}
              />
            ))}
          </ul>
        )}
      </section>
      <section>
        <SectionHead title="Overlaps" meta={String(cap.overlaps.length)} />
        {cap.overlaps.length === 0 ? (
          <p className="text-body text-subtle">No skill is shared by two or more people.</p>
        ) : (
          <ul className="space-y-3">
            {cap.overlaps.map((o) => {
              const names = o.userIds.map((id) =>
                byId.get(id) ? nameOf(byId.get(id)!).split(' ')[0] : 'Unknown',
              );
              return (
                <Callout
                  key={o.skillSlug}
                  kind="overlap"
                  title={`${o.userIds.length} people strong in ${prettySlug(o.skillSlug)}`}
                  body={`${names.join(', ')}. Tasks needing it can absorb a reassignment.`}
                />
              );
            })}
          </ul>
        )}
      </section>
      {busOne.length > 0 && (
        <section>
          <SectionHead title="Single points" meta="bus factor 1" />
          <ul className="space-y-1.5">
            {busOne.map((c) => {
              const top = byId.get(c.topMembers[0]?.userId ?? '');
              return (
                <li key={c.category} className="flex items-center gap-2 text-body">
                  {top && <Avatar m={top} />}
                  <span className="text-default">{catLabel(c.category)}</span>
                  <span className="text-subtle">{top ? `only ${nameOf(top).split(' ')[0]}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}

/* --------------------------------- members --------------------------------- */

function MembersList({ members }: { members: Member[] }) {
  return (
    <ul className="divide-y divide-hover rounded-md border border-border">
      {members.map((m) => (
        <li key={m.user.id}>
          <Link
            to={m.user.id}
            className="hover-light grid grid-cols-(--grid-member-row) items-center gap-3 rounded-md px-4 py-3 sm:grid-cols-(--grid-member-row-sm)"
          >
            <Avatar m={m} />
            <span className="min-w-0">
              <span className="block truncate text-body font-medium text-strong">{nameOf(m)}</span>
              <span className="block truncate text-label text-subtle">
                {m.role === 'owner' ? 'Owner · ' : ''}
                {m.profile.headline ?? `@${m.user.githubLogin}`}
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5 max-sm:hidden">
              {m.topSkills.map((s) => (
                <span
                  key={s.slug}
                  className={cn(
                    'inline-flex h-5 items-center rounded-full border px-2 text-caption',
                    s.confirmed
                      ? 'border-border-strong text-muted'
                      : 'border-dashed border-level-4 text-subtle',
                  )}
                >
                  {prettySlug(s.slug)} {s.confirmed ? s.level : `≈${s.level}`}
                </span>
              ))}
            </span>
            <span className="text-right text-body text-muted">{Math.round(m.profile.availableHours)}h</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------- page ---------------------------------- */

function Skeleton() {
  const b = 'animate-pulse rounded-md bg-raised';
  return (
    <div className="grid gap-7 p-7 lg:grid-cols-(--grid-side-320)" aria-busy="true" aria-label="Loading team">
      <div className="space-y-7">
        <div className={cn(b, 'h-64')} />
        <div className={cn(b, 'h-60')} />
      </div>
      <div className="space-y-3">
        <div className={cn(b, 'h-24')} />
        <div className={cn(b, 'h-24')} />
      </div>
    </div>
  );
}

export function Team() {
  const { wid = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(search.get('tab') ?? '')
    ? (search.get('tab') as Tab)
    : 'capability';
  const now = useNow();

  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me') });
  const board = useQuery({
    queryKey: qk('getBoard', { pid: ids.project }),
    queryFn: () => api('getBoard', { params: { pid: ids.project } }),
  });
  const cap = useQuery({
    queryKey: qk('teamCapability', { wid }),
    queryFn: () => api('teamCapability', { params: { wid } }),
  });
  const members = useQuery({
    queryKey: qk('listMembers', { wid }),
    queryFn: () => api('listMembers', { params: { wid } }),
  });
  const workspace = useQuery({
    queryKey: qk('getWorkspace', { wid }),
    queryFn: () => api('getWorkspace', { params: { wid } }),
  });
  const skills = useQueries({
    queries: (members.data ?? []).map((m) => ({
      queryKey: qk('memberSkills', { wid, uid: m.user.id }),
      queryFn: () => api('memberSkills', { params: { wid, uid: m.user.id } }),
    })),
  });

  const cells = new Map<string, Map<SkillCategory, Cell>>();
  (members.data ?? []).forEach((m, i) => {
    const d = skills[i]?.data;
    if (d) cells.set(m.user.id, buildCells(d));
  });

  // Plan needs per category: required skill slugs mapped through the skills we know about.
  const slugCategory = new Map<string, SkillCategory>();
  for (const q of skills) for (const ms of q.data ?? []) slugCategory.set(ms.skill.slug, ms.skill.category);
  const needs = new Map<SkillCategory, number>();
  for (const t of board.data?.tasks ?? []) {
    if (t.status === 'cut') continue;
    for (const r of t.requiredSkills) {
      const c = slugCategory.get(r.skillSlug);
      if (c) needs.set(c, Math.max(needs.get(c) ?? 0, r.level));
    }
  }

  const error = cap.error ?? members.error;
  if (error)
    return (
      <div className="p-7">
        <div role="alert" className="max-w-xl rounded-md border border-border bg-surface p-5">
          <p className="text-body font-medium text-strong">Couldn't load the team.</p>
          <p className="mt-1 text-body text-subtle">
            {error.message}. Nothing was changed; your skills and availability are safe.
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              void cap.refetch();
              void members.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  if (!cap.data || !members.data) return <Skeleton />;

  const ms = members.data;
  const start = Date.parse(
    workspace.data?.startsAt ?? cap.data.availabilityCurve[0]?.bucketStart ?? new Date(now).toISOString(),
  );
  const end = Date.parse(workspace.data?.deadlineAt ?? new Date(start + 36 * 3_600_000).toISOString());

  const tabs = (
    <div role="tablist" aria-label="Team views" className="flex items-center gap-1">
      {TABS.map((t) => (
        <button
          key={t}
          role="tab"
          type="button"
          aria-selected={tab === t}
          onClick={() => setSearch(t === 'capability' ? {} : { tab: t }, { replace: true })}
          className={cn(
            'h-control-sm rounded-sm px-2.5 text-body capitalize transition-colors duration-(--duration-instant)',
            tab === t ? 'bg-hover text-strong' : 'text-subtle hover:bg-raised hover:text-strong',
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <div className="p-7 max-sm:p-4">
      <div className="mb-7 flex flex-wrap items-center gap-3">
        {tabs}
        <Link to="../plan" className="ml-auto">
          <Button variant="primary">Plan a project with this team</Button>
        </Link>
      </div>

      {ms.length === 0 ? (
        <div className="grid place-items-center gap-3 py-20 text-center">
          <div aria-hidden className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-10 w-16 rounded-xs border border-dashed border-border-strong" />
            ))}
          </div>
          <p className="text-body text-muted">Invite teammates to see what this team can build.</p>
          <Link to="../settings">
            <Button variant="primary">Invite teammates</Button>
          </Link>
        </div>
      ) : tab === 'members' ? (
        <MembersList members={ms} />
      ) : tab === 'availability' ? (
        <AvailabilityChart
          members={ms}
          start={start}
          end={end}
          now={now}
          totalHours={cap.data.totalAvailableHours}
          tall
        />
      ) : (
        <div className="grid gap-7 lg:grid-cols-(--grid-side-320)">
          <div className="min-w-0 space-y-9">
            <CapabilityMatrix
              members={ms}
              cells={cells}
              cap={cap.data}
              skillsLoading={skills.some((s) => s.isPending)}
              needs={needs}
              meId={me.data?.user.id ?? null}
              wid={wid}
            />
            <AvailabilityChart
              members={ms}
              start={start}
              end={end}
              now={now}
              totalHours={cap.data.totalAvailableHours}
            />
          </div>
          <SidePanel cap={cap.data} members={ms} />
        </div>
      )}
    </div>
  );
}
>>>>>>> 03cec4370982ad691ab44c2b85c1fdb07daf8a7b
