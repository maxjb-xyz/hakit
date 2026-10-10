/** Real API over isolated WASM Postgres; no shared database or paid provider calls. */
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { schema } from '@hakit/db';
import { eq } from 'drizzle-orm';
import { MemberSkill, Skill, TeamCapability } from '@hakit/contracts';
import { createHarness } from '../test/harness';
import { importSkillFacts } from '../jobs/skills-import';
import { searchTaxonomy } from '../services/capability';
let h: Awaited<ReturnType<typeof createHarness>>,
  owner: Awaited<ReturnType<Awaited<ReturnType<typeof createHarness>>['signIn']>>,
  other: typeof owner,
  outsider: typeof owner,
  wid: string,
  otherWid: string,
  reactId: string;
const start = '2026-10-10T00:00:00Z',
  end = '2026-10-10T06:00:00Z';
beforeAll(async () => {
  h = await createHarness();
  owner = await h.signIn(206);
  other = await h.signIn(207);
  outsider = await h.signIn(208);
  const [w] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Team',
      slug: 'cap-team',
      createdBy: owner.id,
      startsAt: new Date(start),
      deadlineAt: new Date(end),
    })
    .returning();
  wid = w!.id;
  const [w2] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Other',
      slug: 'cap-other',
      createdBy: outsider.id,
      startsAt: new Date(start),
      deadlineAt: new Date(end),
    })
    .returning();
  otherWid = w2!.id;
  await h.db.insert(schema.memberships).values([
    { workspaceId: wid, userId: owner.id, role: 'owner', colorIndex: 0 },
    { workspaceId: wid, userId: other.id, role: 'member', colorIndex: 1 },
    { workspaceId: otherWid, userId: outsider.id, role: 'owner', colorIndex: 0 },
  ]);
}, 30000);
beforeEach(async () => {
  await h.db.delete(schema.skills);
  await h.db.delete(schema.memberProfiles);
  await h.db.delete(schema.memberEmbeddings);
  h.jobs.send.mockReset();
  h.jobs.send.mockResolvedValue();
  const rows = await h.db
    .insert(schema.skills)
    .values([
      { slug: 'react', name: 'React', category: 'frontend', aliases: ['reactjs', 'React.js'] },
      { slug: 'python', name: 'Python', category: 'backend', aliases: ['py'] },
      { slug: 'typescript', name: 'TypeScript', category: 'frontend', aliases: ['ts'] },
    ])
    .returning();
  reactId = rows.find((s) => s.slug === 'react')!.id;
  await h.db.insert(schema.memberProfiles).values({
    workspaceId: wid,
    userId: owner.id,
    availability: [{ start, end, kind: 'available' }],
    availableHours: 6,
  });
});
const put = (slug = 'react', body: unknown = { level: 4 }, token = owner.token) =>
  h.call(`/me/skills/${slug}`, { method: 'PUT', token, json: body });
const list = (uid = owner.id, workspace = wid, token = owner.token) =>
  h.call(`/w/${workspace}/members/${uid}/skills`, { token });
it('returns valid member skills with imported evidence and no removed rows', async () => {
  await h.db
    .insert(schema.memberSkills)
    .values({ userId: owner.id, skillId: reactId, source: 'inferred', level: 3, confidence: 0.8 });
  await h.db.insert(schema.skillEvidence).values({
    userId: owner.id,
    skillId: reactId,
    kind: 'manifest_dependency',
    sourceRef: 'owner/app:package.json',
    weight: 1,
    summary: 'react in package.json',
    observedAt: new Date(start),
  });
  const res = await list();
  expect(res.status).toBe(200);
  const rows = MemberSkill.array().parse(await res.json());
  expect(rows[0]).toMatchObject({
    source: 'inferred',
    evidence: [{ skillSlug: 'react', summary: 'react in package.json' }],
  });
  expect(res.headers.get('cache-control')).toBe('no-store');
});
it('confirms a skill with confidence one, stores self evidence, and queues refresh after commit', async () => {
  h.jobs.send.mockImplementation(async () => {
    expect(await h.db.select().from(schema.memberSkills)).toHaveLength(1);
  });
  const res = await put();
  expect(res.status).toBe(200);
  expect(MemberSkill.parse(await res.json())).toMatchObject({
    source: 'confirmed',
    confidence: 1,
    level: 4,
    evidence: [{ kind: 'self_report', summary: 'Member confirmed level 4' }],
  });
  expect(h.jobs.send).toHaveBeenCalledWith({ type: 'embed.batch', target: 'member', ids: [owner.id] });
});
it('preserves imported evidence when a member confirms', async () => {
  await h.db.insert(schema.skillEvidence).values({
    userId: owner.id,
    skillId: reactId,
    kind: 'repo_topic',
    sourceRef: 'owner/app',
    weight: 0.5,
    summary: 'React topic',
    observedAt: new Date(start),
  });
  await put();
  expect((await h.db.select().from(schema.skillEvidence)).map((e) => e.kind).sort()).toEqual([
    'repo_topic',
    'self_report',
  ]);
});
it('stores explicit unconfirmed entries as self-added, protected from inference', async () => {
  const res = await put('react', { level: 2, confirmed: false });
  expect(MemberSkill.parse(await res.json())).toMatchObject({
    source: 'self_added',
    confirmedAt: null,
    confidence: 1,
  });
});
it('repeated edits replace self reports without duplication', async () => {
  await put();
  await put('react', { level: 5 });
  expect(await h.db.select().from(schema.memberSkills)).toHaveLength(1);
  expect(await h.db.select().from(schema.skillEvidence)).toHaveLength(1);
  expect((await h.db.select().from(schema.memberSkills))[0]!.level).toBe(5);
});
it('removes a skill as a negative report and excludes it from responses', async () => {
  await put();
  const response = await h.call('/me/skills/react', { method: 'DELETE', token: owner.token });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(await (await list()).json()).toEqual([]);
  expect((await h.db.select().from(schema.memberSkills))[0]).toMatchObject({
    source: 'removed',
    confidence: 0,
  });
  expect((await h.db.select().from(schema.skillEvidence))[0]).toMatchObject({
    kind: 'self_report',
    weight: 0,
    detail: { removed: true, confirmed: false },
  });
});
it('records removal even for a taxonomy skill that was never imported', async () => {
  await h.call('/me/skills/react', { method: 'DELETE', token: owner.token });
  await h.call('/me/skills/react', { method: 'DELETE', token: owner.token });
  expect(await h.db.select().from(schema.memberSkills)).toHaveLength(1);
  expect(await h.db.select().from(schema.skillEvidence)).toHaveLength(1);
});
it('does not re-add a removed skill on import; explicit re-add is allowed', async () => {
  await h.call('/me/skills/react', { method: 'DELETE', token: owner.token });
  await importSkillFacts(
    h.db,
    owner.id,
    [
      {
        fullName: 'owner/app',
        url: 'https://github.com/owner/app',
        pushedAt: new Date(start),
        sizeKb: 750,
        isFork: false,
        languages: {},
        topics: ['reactjs'],
        files: {},
        readmeExcerpt: null,
      },
    ],
    { name: 'hf', model: 'Qwen/Qwen3-Embedding-0.6B', dim: 1024, embed: vi.fn() },
    new Date(start),
    async () => {},
  );
  expect(await (await list()).json()).toEqual([]);
  await put();
  expect(MemberSkill.array().parse(await (await list()).json())[0]!.source).toBe('confirmed');
});
it('clears stale member vectors across workspaces when skills change', async () => {
  await h.db.insert(schema.memberEmbeddings).values({
    workspaceId: wid,
    userId: owner.id,
    kind: 'profile',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
  });
  await h.db.insert(schema.memberEmbeddings).values({
    workspaceId: otherWid,
    userId: owner.id,
    kind: 'interests',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
  });
  await put();
  expect(await h.db.select().from(schema.memberEmbeddings)).toHaveLength(0);
});
it('reports queue failure as saved changes with a pending refresh; retry is idempotent', async () => {
  h.jobs.send.mockRejectedValueOnce(new Error('queue unavailable'));
  const res = await put();
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: { code: 'embedding_refresh_pending' } });
  expect(await h.db.select().from(schema.memberSkills)).toHaveLength(1);
  expect((await put()).status).toBe(200);
  expect(await h.db.select().from(schema.skillEvidence)).toHaveLength(1);
});
it('searches names and aliases case-insensitively and ranks exact matches first', async () => {
  const r = await h.call('/skills?q=React.js', { token: owner.token });
  expect(r.status).toBe(200);
  expect(
    Skill.array()
      .parse(await r.json())
      .map((s) => s.slug),
  ).toEqual(['react']);
  expect(await (await h.call('/skills?q=PY', { token: owner.token })).json()).toMatchObject([
    { slug: 'python' },
  ]);
});
it('supports empty search, unmatched queries and literal wildcard characters', async () => {
  expect((await (await h.call('/skills', { token: owner.token })).json()) as unknown[]).toHaveLength(3);
  expect(await (await h.call('/skills?q=%25', { token: owner.token })).json()).toEqual([]);
  expect(await (await h.call('/skills?q=nothing-matches', { token: owner.token })).json()).toEqual([]);
  expect((await h.call(`/skills?q=${'a'.repeat(121)}`, { token: owner.token })).status).toBe(400);
});
it('computes real team coverage and availability, excluding other workspaces', async () => {
  await put();
  await h.db
    .insert(schema.memberSkills)
    .values({ userId: outsider.id, skillId: reactId, source: 'confirmed', level: 5, confidence: 1 });
  const res = await h.call(`/w/${wid}/capability`, { token: owner.token });
  expect(res.status).toBe(200);
  const r = TeamCapability.parse(await res.json());
  expect(r.categories.find((c) => c.category === 'frontend')).toMatchObject({ coverage: 4, busFactor: 1 });
  expect(r.totalAvailableHours).toBe(6);
  expect(r.totalEffectiveHours).toBe(4.2);
  expect(r.availabilityCurve.map((b) => b.hours)).toEqual([2, 2, 2]);
  expect(r.aiSummary).toBeNull();
});
it('accepts teammates without profiles and excludes removed skills from coverage', async () => {
  await h.call('/me/skills/react', { method: 'DELETE', token: owner.token });
  const r = TeamCapability.parse(await (await h.call(`/w/${wid}/capability`, { token: owner.token })).json());
  expect(r.categories.find((c) => c.category === 'frontend')!.coverage).toBe(0);
  expect(await (await list(other.id)).json()).toEqual([]);
});
it('uses workspace creation time when no explicit start is set', async () => {
  await h.db
    .update(schema.workspaces)
    .set({ startsAt: null, createdAt: new Date(start) })
    .where(eq(schema.workspaces.id, wid));
  const r = await h.call(`/w/${wid}/capability`, { token: owner.token });
  expect(r.status).toBe(200);
  expect(TeamCapability.parse(await r.json()).availabilityCurve[0]!.bucketStart).toBe(
    new Date(start).toISOString(),
  );
  await h.db
    .update(schema.workspaces)
    .set({ startsAt: new Date(start) })
    .where(eq(schema.workspaces.id, wid));
});
it('rejects nonmembers and member IDs from unrelated workspaces', async () => {
  expect((await list(owner.id, wid, outsider.token)).status).toBe(404);
  expect((await list(outsider.id)).status).toBe(404);
  expect((await list('invalid')).status).toBe(404);
  expect((await h.call(`/w/${wid}/capability`, { token: outsider.token })).status).toBe(404);
});
it('rejects unknown skills, malformed slugs, invalid levels and missing auth/CSRF', async () => {
  expect((await put('unknown')).status).toBe(404);
  expect((await put('BAD')).status).toBe(404);
  expect((await put('react', { level: 6 })).status).toBe(400);
  expect((await h.call('/me/skills/react', { method: 'PUT', json: { level: 4 } })).status).toBe(401);
  expect(
    (await h.call('/me/skills/react', { method: 'PUT', token: owner.token, json: { level: 4 }, csrf: false }))
      .status,
  ).toBe(403);
  expect(
    (await h.call('/me/skills/react', { method: 'DELETE', token: owner.token, csrf: false })).status,
  ).toBe(403);
  expect(await h.db.select().from(schema.memberSkills)).toHaveLength(0);
});

it('uses semantic search for unmatched descriptions and degrades safely on provider failure', async () => {
  await h.db
    .update(schema.skills)
    .set({ embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)) })
    .where(eq(schema.skills.id, reactId));
  const provider = {
    name: 'hf' as const,
    model: 'Qwen/Qwen3-Embedding-0.6B',
    dim: 1024,
    embed: vi.fn(async () => [Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))]),
  };
  expect((await searchTaxonomy(h.db, 'frontend components', provider)).map((s) => s.slug)).toEqual(['react']);
  expect(provider.embed).toHaveBeenCalledWith(['frontend components'], 'query');
  provider.embed.mockRejectedValueOnce(new Error('offline'));
  expect(await searchTaxonomy(h.db, 'frontend components', provider)).toEqual([]);
});
it('does not spend embedding calls on exact aliases, short terms or an unembedded taxonomy', async () => {
  const provider = {
    name: 'hf' as const,
    model: 'Qwen/Qwen3-Embedding-0.6B',
    dim: 1024,
    embed: vi.fn(async () => []),
  };
  await searchTaxonomy(h.db, 'reactjs', provider);
  await searchTaxonomy(h.db, 'x', provider);
  await searchTaxonomy(h.db, 'new description', provider);
  expect(provider.embed).not.toHaveBeenCalled();
});
it('bounds search results for large taxonomies', async () => {
  await h.db.insert(schema.skills).values(
    Array.from({ length: 60 }, (_, i) => ({
      slug: `skill-${i}`,
      name: `Skill ${i}`,
      category: 'backend' as const,
      aliases: [],
    })),
  );
  expect(await searchTaxonomy(h.db, '')).toHaveLength(50);
});

it('ignores a supplied user ID and edits only the signed-in member', async () => {
  const res = await put('react', { level: 4, userId: other.id });
  expect(res.status).toBe(200);
  const rows = await h.db.select().from(schema.memberSkills);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.userId).toBe(owner.id);
});
it('uses only the workspace-specific profile when a member has multiple profiles', async () => {
  await h.db.insert(schema.memberProfiles).values({
    workspaceId: otherWid,
    userId: owner.id,
    availableHours: 100,
    availability: [{ start, end, kind: 'away' }],
  });
  const r = TeamCapability.parse(await (await h.call(`/w/${wid}/capability`, { token: owner.token })).json());
  expect(r.totalAvailableHours).toBe(6);
});
it('returns an actionable error for an unsupported event interval', async () => {
  await h.db
    .update(schema.workspaces)
    .set({ deadlineAt: new Date('2099-01-01') })
    .where(eq(schema.workspaces.id, wid));
  const res = await h.call(`/w/${wid}/capability`, { token: owner.token });
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ error: { code: 'invalid_capability_window' } });
  await h.db
    .update(schema.workspaces)
    .set({ deadlineAt: new Date(end) })
    .where(eq(schema.workspaces.id, wid));
});
