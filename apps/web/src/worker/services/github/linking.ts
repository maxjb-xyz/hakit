/**
 * Activity↔task linking (T-406, docs/AI.md §C.5) and author mapping (T-407).
 * Confirmed links come from explicit `HK-n` references; inferred links come from the engine's embedding match.
 */
import { schema, type Db } from '@hakit/db';
import { ActivityEvent, Id, type ActivityEvent as Activity } from '@hakit/contracts';
import { taskNumberFromBranch, taskNumbersFromText, type LinkCandidate } from '@hakit/engine';
import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { conflict, notFound } from '../../lib/errors';

type Read = Pick<Db, 'select'>;

/** Explicit references in priority order: the branch name, then the commit message / PR text. */
export function referencedTaskNumbers(ref: string | null, text: string): number[] {
  const branch = taskNumberFromBranch(ref);
  return [...new Set([...(branch === null ? [] : [branch]), ...taskNumbersFromText(text)])];
}

/** The first referenced number that names a task in the project. */
export async function taskForReferences(db: Read, projectId: string, numbers: number[]) {
  if (!numbers.length) return null;
  const rows = await db
    .select({ id: schema.tasks.id, number: schema.tasks.number })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), inArray(schema.tasks.number, numbers)));
  for (const n of numbers) {
    const row = rows.find((r) => r.number === n);
    if (row) return row.id;
  }
  return null;
}

/** Text embedded for inferred linking: only the stored title (commit subject / PR title) and branch name. */
export function activityLinkText(event: Pick<Activity, 'title' | 'ref'>): string {
  return [event.title, event.ref].filter((s): s is string => !!s?.trim()).join('\n');
}

export function activityFromRow(row: typeof schema.activityEvents.$inferSelect): Activity {
  return ActivityEvent.parse({ ...row, ts: row.ts.toISOString() });
}

const ACTIVE_STATUSES = ['in_progress', 'in_review', 'blocked'] as const;

/** Open tasks with embeddings, plus their active assignees, for the engine's inferred match. */
export async function linkCandidates(db: Read, projectId: string): Promise<LinkCandidate[]> {
  const tasks = await db
    .select({ id: schema.tasks.id, status: schema.tasks.status, embedding: schema.tasks.embedding })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        notInArray(schema.tasks.status, ['done', 'cut']),
        isNotNull(schema.tasks.embedding),
      ),
    );
  if (!tasks.length) return [];
  const assignees = await db
    .select({ taskId: schema.assignments.taskId, userId: schema.assignments.userId })
    .from(schema.assignments)
    .where(
      and(
        inArray(
          schema.assignments.taskId,
          tasks.map((t) => t.id),
        ),
        eq(schema.assignments.status, 'active'),
      ),
    );
  return tasks.map((t) => ({
    taskId: t.id,
    embedding: t.embedding!,
    assigneeIds: assignees.filter((a) => a.taskId === t.id).map((a) => a.userId),
    active: (ACTIVE_STATUSES as readonly string[]).includes(t.status),
  }));
}

/**
 * Manual link/unlink (T-406). The caller is already authorized for the event's project by the route guard;
 * the task must belong to that same project. Manual links are `confirmed` with no confidence.
 */
export async function setManualLink(db: Db, eventId: string, taskId: string | null): Promise<Activity> {
  if (!Id.safeParse(eventId).success) throw notFound('Activity');
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: schema.activityEvents.id, projectId: schema.activityEvents.projectId })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.id, eventId))
      .limit(1);
    if (!event) throw notFound('Activity');
    if (taskId !== null) {
      const [task] = await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.projectId, event.projectId)))
        .limit(1);
      if (!task) throw notFound('Task');
    }
    const [row] = await tx
      .update(schema.activityEvents)
      .set({ taskId, linkKind: taskId ? 'confirmed' : 'none', linkConfidence: null })
      .where(and(eq(schema.activityEvents.id, eventId), eq(schema.activityEvents.projectId, event.projectId)))
      .returning();
    if (!row) throw notFound('Activity');
    return activityFromRow(row);
  });
}

export function aliasKind(raw: string): 'noreply' | 'email' | 'login' {
  if (/^\d+\+[^@]+@users\.noreply\.github\.com$/i.test(raw)) return 'noreply';
  return raw.includes('@') ? 'email' : 'login';
}

/**
 * Remember a GitHub author → member mapping (T-407) and attribute that author's unattributed activity in the
 * workspace's projects. Aliases are global, so an alias already mapped to someone else is a conflict rather than
 * a silent reassignment. Returns the latest re-attributed event per project for post-commit broadcasting.
 */
export async function mapAuthorAlias(
  db: Db,
  workspaceId: string,
  raw: string,
  userId: string,
): Promise<Activity[]> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)))
      .limit(1);
    if (!member) throw notFound('Member');
    const [existing] = await tx
      .select({ userId: schema.authorAliases.userId })
      .from(schema.authorAliases)
      .where(eq(schema.authorAliases.emailOrLogin, raw))
      .for('update')
      .limit(1);
    if (existing && existing.userId !== userId)
      throw conflict('This author is already mapped to another member');
    await tx
      .insert(schema.authorAliases)
      .values({ emailOrLogin: raw, userId, kind: aliasKind(raw), confirmed: true })
      .onConflictDoUpdate({ target: schema.authorAliases.emailOrLogin, set: { confirmed: true } });
    const projects = tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId));
    const rows = await tx
      .update(schema.activityEvents)
      .set({ actorUserId: userId })
      .where(
        and(
          isNull(schema.activityEvents.actorUserId),
          eq(schema.activityEvents.actorRaw, raw),
          inArray(schema.activityEvents.projectId, projects),
        ),
      )
      .returning();
    const latest = new Map<string, typeof schema.activityEvents.$inferSelect>();
    for (const row of rows) {
      const current = latest.get(row.projectId);
      if (!current || row.ts > current.ts) latest.set(row.projectId, row);
    }
    return [...latest.values()].map(activityFromRow);
  });
}
