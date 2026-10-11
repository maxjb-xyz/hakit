/** Auth, workspaces, invites, members, profiles. Owner: PL (T-201..T-203). */
import { Hono, type Context } from 'hono';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  Id,
  type AvailabilityWindow,
  type Member,
  type MemberProfile,
  type Workspace,
} from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { schema, type Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { forbidden, HttpError, notFound } from '../lib/errors';
import { availableHours, validateAvailability } from '../lib/availability';
import { clearSessionCookie, deleteSession, readSessionCookie } from '../lib/session';
import { assertOwner } from '../middleware/auth';

export const identity = new Hono<AppEnv>();

const { users, workspaces, memberships, invites, memberProfiles, hackathonTemplates } = schema;
type WorkspaceRow = typeof workspaces.$inferSelect;
type ProfileRow = typeof memberProfiles.$inferSelect;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

const toWorkspace = (w: WorkspaceRow): Workspace => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  hackathonTemplateId: w.hackathonTemplateId,
  startsAt: isoOrNull(w.startsAt),
  deadlineAt: iso(w.deadlineAt),
  createdAt: iso(w.createdAt),
});

const toProfile = (p: ProfileRow): MemberProfile => ({
  userId: p.userId,
  workspaceId: p.workspaceId,
  headline: p.headline,
  timezone: p.timezone,
  interests: p.interests,
  learningGoals: p.learningGoals,
  avoid: p.avoid,
  availability: p.availability as AvailabilityWindow[],
  availableHours: Number(p.availableHours),
  onboardingCompletedAt: isoOrNull(p.onboardingCompletedAt),
});

const badRequest = (message: string) => new HttpError(400, 'invalid_body', message);
const me = (c: Context<AppEnv>) => c.var.user!;

async function loadWorkspace(db: Db, wid: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, wid)).limit(1);
  if (!w) throw notFound('Workspace');
  return w;
}

/**
 * Template (when given) supplies the event window; explicit dates win. On update, `hackathonSlug: null` detaches
 * the template (dates stay), `startsAt: null` clears the start, and omitted fields keep their current value.
 */
async function resolveDates(
  db: Db,
  body: { hackathonSlug?: string | null; startsAt?: string | null; deadlineAt?: string },
  current?: WorkspaceRow,
) {
  let templateId = current?.hackathonTemplateId ?? null;
  let startsAt =
    body.startsAt === null
      ? null
      : body.startsAt !== undefined
        ? new Date(body.startsAt)
        : (current?.startsAt ?? null);
  let deadlineAt = body.deadlineAt ? new Date(body.deadlineAt) : (current?.deadlineAt ?? null);
  if (body.hackathonSlug === null) {
    templateId = null;
  } else if (body.hackathonSlug !== undefined) {
    const [t] = await db
      .select()
      .from(hackathonTemplates)
      .where(eq(hackathonTemplates.slug, body.hackathonSlug))
      .limit(1);
    if (!t) throw badRequest(`Unknown hackathon "${body.hackathonSlug}"`);
    // Re-sending the current template with no dates keeps the (possibly edited) window; a new one brings its own.
    const changed = t.id !== current?.hackathonTemplateId;
    templateId = t.id;
    if (body.startsAt === undefined && changed) startsAt = t.startsAt;
    if (!body.deadlineAt && changed) deadlineAt = t.endsAt;
  }
  if (!deadlineAt) throw badRequest('deadlineAt is required when no hackathon template is chosen');
  if (startsAt && startsAt >= deadlineAt) throw badRequest('startsAt must be before deadlineAt');
  return { hackathonTemplateId: templateId, startsAt, deadlineAt };
}

async function templateSlug(db: Db, templateId: string | null) {
  if (!templateId) return null;
  const [t] = await db
    .select({ slug: hackathonTemplates.slug })
    .from(hackathonTemplates)
    .where(eq(hackathonTemplates.id, templateId))
    .limit(1);
  return t?.slug ?? null;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'team';
const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/** 10-char base32 invite code (ARCHITECTURE §5.1). 50 bits; the unique index catches the rare collision. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const inviteCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => BASE32[b & 31]).join('');

const inviteDead = (i: typeof invites.$inferSelect, now: Date) =>
  i.revokedAt !== null || i.expiresAt <= now || (i.maxUses !== null && i.uses >= i.maxUses);

/* ----------------------------------- me ----------------------------------- */

route(identity, 'me', async ({ c }) => {
  if (c.var.mocks)
    return {
      user: fx.members[0]!.user,
      memberships: [
        {
          workspaceId: fx.ids.workspace,
          userId: fx.ids.users.priya,
          role: 'owner' as const,
          colorIndex: 0,
          joinedAt: fx.workspace.createdAt,
          workspaceName: fx.workspace.name,
        },
      ],
    };
  const db = c.var.db();
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, me(c).id))
    .limit(1);
  if (!u) throw notFound('User');
  const rows = await db
    .select({ m: memberships, workspaceName: workspaces.name })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, u.id))
    .orderBy(asc(memberships.joinedAt));
  return {
    user: {
      id: u.id,
      githubUserId: u.githubUserId,
      githubLogin: u.githubLogin,
      name: u.name,
      avatarUrl: u.avatarUrl,
    },
    memberships: rows.map(({ m, workspaceName }) => ({
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role,
      colorIndex: m.colorIndex,
      joinedAt: iso(m.joinedAt),
      workspaceName,
    })),
  };
});

route(identity, 'logout', async ({ c }) => {
  if (!c.var.mocks) {
    const token = readSessionCookie(c);
    if (token) await deleteSession(c.var.db(), token);
    clearSessionCookie(c);
  }
  return { ok: true as const };
});

/* ------------------------------- workspaces ------------------------------- */

route(identity, 'createWorkspace', async ({ c, body }) => {
  if (c.var.mocks) return { ...fx.workspace, name: body.name };
  const db = c.var.db();
  const dates = await resolveDates(db, body);
  const userId = me(c).id;
  const w = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(workspaces)
      .values({ name: body.name, slug: `${slugify(body.name)}-${randomHex(3)}`, createdBy: userId, ...dates })
      .returning();
    await tx.insert(memberships).values({ workspaceId: w!.id, userId, role: 'owner', colorIndex: 0 });
    await tx.insert(memberProfiles).values({ workspaceId: w!.id, userId });
    return w!;
  });
  return { ...toWorkspace(w), hackathonSlug: await templateSlug(db, w.hackathonTemplateId) };
});

route(identity, 'getWorkspace', async ({ c, params }) => {
  if (c.var.mocks) return fx.workspace;
  const db = c.var.db();
  const w = await loadWorkspace(db, params.wid);
  return { ...toWorkspace(w), hackathonSlug: await templateSlug(db, w.hackathonTemplateId) };
});

route(identity, 'updateWorkspace', async ({ c, params, body }) => {
  if (c.var.mocks) {
    // Stateless echo so the Settings form shows what was saved.
    const custom = body.hackathonSlug === null;
    return {
      ...fx.workspace,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.startsAt !== undefined && { startsAt: body.startsAt }),
      ...(body.deadlineAt !== undefined && { deadlineAt: body.deadlineAt }),
      ...(custom && { hackathonTemplateId: null, hackathonSlug: null }),
    };
  }
  assertOwner(c);
  const db = c.var.db();
  const current = await loadWorkspace(db, params.wid);
  const dates = await resolveDates(db, body, current);
  const [w] = await db
    .update(workspaces)
    .set({ ...(body.name ? { name: body.name } : {}), ...dates })
    .where(eq(workspaces.id, params.wid))
    .returning();
  return { ...toWorkspace(w!), hackathonSlug: await templateSlug(db, w!.hackathonTemplateId) };
});

/* --------------------------------- invites -------------------------------- */

route(identity, 'createInvite', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      id: '11000000-0000-4000-8000-000000000001',
      code: 'ORBIT7K2QX',
      url: `${c.env.APP_URL}/j/ORBIT7K2QX`,
      // Echo the request so the invite panel shows what was asked for.
      expiresAt: new Date(Date.now() + body.expiresInHours * 3_600_000).toISOString(),
      maxUses: body.maxUses,
      uses: 0,
    };
  const [i] = await c.var
    .db()
    .insert(invites)
    .values({
      workspaceId: params.wid,
      code: inviteCode(),
      createdBy: me(c).id,
      expiresAt: new Date(Date.now() + body.expiresInHours * 3_600_000),
      maxUses: body.maxUses,
    })
    .returning();
  return {
    id: i!.id,
    code: i!.code,
    url: `${c.env.APP_URL}/j/${i!.code}`,
    expiresAt: iso(i!.expiresAt),
    maxUses: i!.maxUses,
    uses: i!.uses,
  };
});

route(identity, 'previewInvite', async ({ c, params }) => {
  if (c.var.mocks)
    return {
      workspaceName: fx.workspace.name,
      memberAvatars: fx.members.map((m) => ({ login: m.user.githubLogin, avatarUrl: m.user.avatarUrl })),
      expired: false,
      workspaceId: fx.workspace.id,
    };
  const db = c.var.db();
  const [row] = await db
    .select({ i: invites, workspaceName: workspaces.name })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(eq(invites.code, params.code.toUpperCase()))
    .limit(1);
  if (!row) throw notFound('Invite');
  const avatars = await db
    .select({ login: users.githubLogin, avatarUrl: users.avatarUrl })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, row.i.workspaceId))
    .orderBy(asc(memberships.joinedAt))
    .limit(8);
  return {
    workspaceName: row.workspaceName,
    memberAvatars: avatars,
    expired: inviteDead(row.i, new Date()),
    workspaceId: row.i.workspaceId,
  };
});

route(identity, 'acceptInvite', async ({ c, params }) => {
  if (c.var.mocks) return fx.workspace;
  const userId = me(c).id;
  const w = await c.var.db().transaction(async (tx) => {
    // Lock the invite so concurrent accepts can't exceed max_uses.
    const [i] = await tx
      .select()
      .from(invites)
      .where(eq(invites.code, params.code.toUpperCase()))
      .for('update');
    if (!i) throw notFound('Invite');
    const existing = await tx
      .select({ userId: memberships.userId, colorIndex: memberships.colorIndex })
      .from(memberships)
      .where(eq(memberships.workspaceId, i.workspaceId));
    if (!existing.some((m) => m.userId === userId)) {
      if (inviteDead(i, new Date()))
        throw new HttpError(410, 'invite_expired', 'This invite link has expired');
      const used = new Set(existing.map((m) => m.colorIndex));
      const colorIndex = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => !used.has(k)) ?? existing.length % 8;
      await tx.insert(memberships).values({ workspaceId: i.workspaceId, userId, role: 'member', colorIndex });
      await tx.insert(memberProfiles).values({ workspaceId: i.workspaceId, userId }).onConflictDoNothing();
      await tx
        .update(invites)
        .set({ uses: i.uses + 1 })
        .where(eq(invites.id, i.id));
    }
    const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, i.workspaceId));
    return w!;
  });
  return toWorkspace(w);
});

/* ----------------------------- members & profiles ----------------------------- */

route(identity, 'listMembers', async ({ c, params }) => {
  if (c.var.mocks) return fx.members;
  const db = c.var.db();
  const rows = await db
    .select({ u: users, m: memberships, p: memberProfiles })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(
      memberProfiles,
      and(
        eq(memberProfiles.workspaceId, memberships.workspaceId),
        eq(memberProfiles.userId, memberships.userId),
      ),
    )
    .where(eq(memberships.workspaceId, params.wid))
    .orderBy(asc(memberships.joinedAt));
  const userIds = rows.map((r) => r.u.id);
  if (userIds.length === 0) return [];

  const skillRows = await db
    .select({
      userId: schema.memberSkills.userId,
      slug: schema.skills.slug,
      level: schema.memberSkills.level,
      confidence: schema.memberSkills.confidence,
      source: schema.memberSkills.source,
      confirmedAt: schema.memberSkills.confirmedAt,
    })
    .from(schema.memberSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.memberSkills.skillId))
    .where(and(inArray(schema.memberSkills.userId, userIds), ne(schema.memberSkills.source, 'removed')));

  const current = await db
    .select({ userId: schema.assignments.userId, taskId: schema.tasks.id })
    .from(schema.assignments)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.assignments.taskId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(
      and(
        eq(schema.projects.workspaceId, params.wid),
        eq(schema.assignments.status, 'active'),
        eq(schema.tasks.status, 'in_progress'),
        inArray(schema.assignments.userId, userIds),
      ),
    );

  return rows.map(({ u, m, p }): Member => {
    const top = skillRows
      .filter((s) => s.userId === u.id)
      .sort((a, b) => b.level - a.level || b.confidence - a.confidence)
      .slice(0, 5)
      .map((s) => ({
        slug: s.slug,
        level: s.level,
        confirmed: s.confirmedAt !== null || s.source === 'confirmed' || s.source === 'self_added',
      }));
    return {
      user: {
        id: u.id,
        githubUserId: u.githubUserId,
        githubLogin: u.githubLogin,
        name: u.name,
        avatarUrl: u.avatarUrl,
      },
      role: m.role,
      colorIndex: m.colorIndex,
      profile: toProfile(p),
      topSkills: top,
      currentTaskId: current.find((x) => x.userId === u.id)?.taskId ?? null,
    };
  });
});

async function loadProfile(db: Db, wid: string, uid: string) {
  if (!Id.safeParse(uid).success) throw notFound('Member');
  const [p] = await db
    .select()
    .from(memberProfiles)
    .where(and(eq(memberProfiles.workspaceId, wid), eq(memberProfiles.userId, uid)))
    .limit(1);
  if (!p) throw notFound('Member');
  return p;
}

route(identity, 'getProfile', async ({ c, params }) => {
  if (c.var.mocks) return (fx.members.find((m) => m.user.id === params.uid) ?? fx.members[0]!).profile;
  return toProfile(await loadProfile(c.var.db(), params.wid, params.uid));
});

route(identity, 'updateProfile', async ({ c, params, body }) => {
  const { completeOnboarding, ...fields } = body;
  if (c.var.mocks) {
    const current = (fx.members.find((m) => m.user.id === params.uid) ?? fx.members[0]!).profile;
    return { ...current, ...fields };
  }
  const db = c.var.db();
  const current = await loadProfile(db, params.wid, params.uid); // 404 for non-members first, then 403 for someone else's profile
  if (params.uid !== me(c).id) throw forbidden();
  const patch: Partial<typeof memberProfiles.$inferInsert> = { ...fields };
  if (completeOnboarding && !current.onboardingCompletedAt) patch.onboardingCompletedAt = new Date();
  if (body.availability) {
    const w = await loadWorkspace(db, params.wid);
    const windows = validateAvailability(body.availability, {
      start: w.startsAt ?? w.createdAt,
      end: w.deadlineAt,
    });
    patch.availability = windows;
    patch.availableHours = availableHours(windows);
  }
  if (body.timezone !== undefined && !isTimezone(body.timezone)) throw badRequest('Unknown timezone');
  if (Object.keys(patch).length === 0) return toProfile(await loadProfile(db, params.wid, params.uid));
  const [p] = await db
    .update(memberProfiles)
    .set(patch)
    .where(and(eq(memberProfiles.workspaceId, params.wid), eq(memberProfiles.userId, params.uid)))
    .returning();
  return toProfile(p!);
});

function isTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
