/**
 * T-705 demo workspace seed for REAL mode (docs/DEMO.md). Run it only against a Tiger fork of the
 * dev service (see cli.ts), never the shared dev database.
 *
 * The client still addresses the fixture workspace/project ids (`@hakit/contracts/fixtures` `ids`),
 * so the demo workspace is created with exactly those ids: every screen then reads real rows.
 * The workspace starts "14 hours into the event" relative to `now`, so the countdown, schedule and
 * stall rules behave the same whenever the demo runs. The team is the fixture team (Team Orbit);
 * plans, tasks and assignments are produced live during the demo by the real pipeline.
 */
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { members as fixtureMembers, ids } from '@hakit/contracts/fixtures';
import { schema, type Db } from '@hakit/db';
import { SKILLS } from '@hakit/db/seed/skills';
import { HACKATHONS } from '../../../../packages/db/src/seed/hackathons';

/** Synthetic GitHub ids for seeded teammates: far above real GitHub ids, so sign-ins never collide. */
export const DEMO_GITHUB_ID_BASE = 9_000_000_000;
const HOUR = 3_600_000;

/** The ML-heavy teammate swapped in for the "same idea, different team" beat. */
export const SWAP_MEMBER = {
  id: '40000000-0000-4000-8000-000000000099',
  githubLogin: 'dara-ml',
  name: 'Dara Venn',
  headline: 'Vision models, first time on a web team',
  skills: [
    { slug: 'python', level: 5 },
    { slug: 'pytorch', level: 5 },
    { slug: 'huggingface-transformers', level: 4 },
    { slug: 'computer-vision', level: 4 },
  ],
};

/** Taxonomy + hackathon templates: the same idempotent upserts as packages/db/src/seed/run.ts. */
export async function seedReference(db: Db) {
  for (const s of SKILLS)
    await db
      .insert(schema.skills)
      .values({
        slug: s.slug,
        name: s.name,
        category: s.category,
        aliases: s.aliases,
        related: s.related ?? [],
      })
      .onConflictDoUpdate({
        target: schema.skills.slug,
        set: { name: s.name, category: s.category, aliases: s.aliases, related: s.related ?? [] },
      });
  for (const h of HACKATHONS) {
    const [tpl] = await db
      .insert(schema.hackathonTemplates)
      .values({
        slug: h.slug,
        name: h.name,
        startsAt: new Date(h.startsAt),
        endsAt: new Date(h.endsAt),
        timezone: h.timezone,
        tracks: h.tracks,
        judgingCriteria: h.judgingCriteria,
        sourceUrl: h.sourceUrl,
      })
      .onConflictDoUpdate({ target: schema.hackathonTemplates.slug, set: { name: h.name } })
      .returning({ id: schema.hackathonTemplates.id });
    for (const c of h.challenges)
      await db
        .insert(schema.challenges)
        .values({
          hackathonTemplateId: tpl!.id,
          key: c.key,
          sponsor: c.sponsor,
          title: c.title,
          requirements: [...c.requirements],
          requiredTech: [...c.requiredTech],
        })
        .onConflictDoNothing();
  }
}

async function skillIds(db: Db, slugs: string[]) {
  const rows = await db
    .select({ id: schema.skills.id, slug: schema.skills.slug })
    .from(schema.skills)
    .where(inArray(schema.skills.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function addMember(
  db: Db,
  m: {
    userId: string;
    role: 'owner' | 'member';
    colorIndex: number;
    headline: string | null;
    learningGoals: string[];
    interests: string[];
    availableHours: number;
    skills: Array<{ slug: string; level: number; confirmed: boolean }>;
  },
  start: Date,
  deadline: Date,
) {
  await db
    .insert(schema.memberships)
    .values({ workspaceId: ids.workspace, userId: m.userId, role: m.role, colorIndex: m.colorIndex })
    .onConflictDoNothing();
  await db
    .insert(schema.memberProfiles)
    .values({
      workspaceId: ids.workspace,
      userId: m.userId,
      headline: m.headline,
      learningGoals: m.learningGoals,
      interests: m.interests,
      availability: [{ start: start.toISOString(), end: deadline.toISOString(), kind: 'available' }],
      availableHours: m.availableHours,
      onboardingCompletedAt: start,
    })
    .onConflictDoNothing();
  const byslug = await skillIds(
    db,
    m.skills.map((s) => s.slug),
  );
  for (const s of m.skills)
    await db
      .insert(schema.memberSkills)
      .values({
        userId: m.userId,
        skillId: byslug.get(s.slug)!,
        level: s.level,
        confidence: s.confirmed ? 1 : 0.7,
        source: s.confirmed ? 'confirmed' : 'inferred',
        confirmedAt: s.confirmed ? start : null,
      })
      .onConflictDoNothing();
}

export interface SeedOptions {
  now: Date;
  /** GitHub login of the presenter. They must have signed in once so their user row exists. */
  ownerLogin?: string;
}

/** Removes the demo workspace (cascades to projects, plans, tasks, activity) and seeded teammates. */
export async function resetDemo(db: Db) {
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
  await db
    .delete(schema.users)
    .where(
      and(
        gte(schema.users.githubUserId, DEMO_GITHUB_ID_BASE),
        lt(schema.users.githubUserId, DEMO_GITHUB_ID_BASE + 1000),
      ),
    );
}

export async function seedDemo(db: Db, opts: SeedOptions) {
  await seedReference(db);
  await resetDemo(db);
  const start = new Date(opts.now.getTime() - 14 * HOUR);
  const deadline = new Date(opts.now.getTime() + 22 * HOUR);
  const [template] = await db
    .select()
    .from(schema.hackathonTemplates)
    .where(eq(schema.hackathonTemplates.slug, 'knight-hacks-ix'));
  for (const [i, m] of fixtureMembers.entries())
    await db.insert(schema.users).values({
      id: m.user.id,
      githubUserId: DEMO_GITHUB_ID_BASE + i + 1,
      githubLogin: m.user.githubLogin,
      name: m.user.name,
    });
  let owner: string = ids.users.priya;
  if (opts.ownerLogin) {
    const [presenter] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.githubLogin, opts.ownerLogin));
    if (!presenter)
      throw new Error(`No user ${opts.ownerLogin}: sign in to the forked deployment once, then re-run`);
    owner = presenter.id;
  }
  await db.insert(schema.workspaces).values({
    id: ids.workspace,
    name: 'Team Orbit (demo)',
    slug: 'team-orbit-demo',
    hackathonTemplateId: template?.id ?? null,
    startsAt: start,
    deadlineAt: deadline,
    createdBy: owner,
  });
  for (const m of fixtureMembers)
    await addMember(
      db,
      {
        userId: m.user.id,
        role: m.user.id === owner ? 'owner' : 'member',
        colorIndex: m.colorIndex,
        headline: m.profile.headline,
        learningGoals: m.profile.learningGoals,
        interests: m.profile.interests,
        availableHours: m.profile.availableHours,
        skills: m.topSkills.map((s) => ({ ...s })),
      },
      start,
      deadline,
    );
  if (owner !== ids.users.priya)
    await addMember(
      db,
      {
        userId: owner,
        role: 'owner',
        colorIndex: fixtureMembers.length,
        headline: 'Presenter',
        learningGoals: [],
        interests: [],
        availableHours: 20,
        skills: [{ slug: 'typescript', level: 4, confirmed: true }],
      },
      start,
      deadline,
    );
  await db.insert(schema.projects).values({
    id: ids.project,
    workspaceId: ids.workspace,
    name: 'Hakit',
    pitch: 'The hackathon OS that knows your team and knows what to build next.',
    status: 'ideating',
  });
  return { workspaceId: ids.workspace, projectId: ids.project, owner, startsAt: start, deadlineAt: deadline };
}

/** "Same idea, different team": replace the strongest React member with an ML-heavy one (or back). */
export async function swapTeam(db: Db, now: Date) {
  const sam = ids.users.sam;
  const [current] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, ids.workspace), eq(schema.memberships.userId, sam)));
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
  if (!ws) throw new Error('Seed the demo workspace first');
  if (current) {
    await db
      .delete(schema.memberships)
      .where(and(eq(schema.memberships.workspaceId, ids.workspace), eq(schema.memberships.userId, sam)));
    await db
      .insert(schema.users)
      .values({
        id: SWAP_MEMBER.id,
        githubUserId: DEMO_GITHUB_ID_BASE + 99,
        githubLogin: SWAP_MEMBER.githubLogin,
        name: SWAP_MEMBER.name,
      })
      .onConflictDoNothing();
    await addMember(
      db,
      {
        userId: SWAP_MEMBER.id,
        role: 'member',
        colorIndex: 3,
        headline: SWAP_MEMBER.headline,
        learningGoals: ['react'],
        interests: [],
        availableHours: 30,
        skills: SWAP_MEMBER.skills.map((s) => ({ ...s, confirmed: true })),
      },
      ws.startsAt ?? now,
      ws.deadlineAt,
    );
    return 'ml-heavy' as const;
  }
  await db
    .delete(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, ids.workspace), eq(schema.memberships.userId, SWAP_MEMBER.id)),
    );
  await db
    .insert(schema.memberships)
    .values({ workspaceId: ids.workspace, userId: sam, role: 'member', colorIndex: 3 })
    .onConflictDoNothing();
  return 'web' as const;
}

/**
 * Stall switch (T-705 AC): move task HK-<n> to in progress with `started_at` two hours ago, so the
 * stalled-critical-task rule can fire on the next `recs.evaluate` run instead of after real waiting.
 */
export async function stallTask(db: Db, number: number, now: Date) {
  const where = and(eq(schema.tasks.projectId, ids.project), eq(schema.tasks.number, number));
  const [task] = await db.select().from(schema.tasks).where(where);
  if (!task) throw new Error(`HK-${number} does not exist yet: accept a plan first`);
  // The rule's threshold is max(stallMinutes, half the estimate); clear it with 15 minutes to spare.
  const quietMs = Math.max(2 * HOUR, task.estimateHours * 0.5 * HOUR + 15 * 60_000);
  await db
    .update(schema.tasks)
    .set({ status: 'in_progress', startedAt: new Date(now.getTime() - quietMs), updatedAt: now })
    .where(where);
  return { id: task.id, quietHours: quietMs / HOUR };
}
