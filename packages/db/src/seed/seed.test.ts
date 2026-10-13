import { describe, expect, it } from 'vitest';
import { SKILLS } from './skills';
import { HACKATHONS } from './hackathons';
import * as fx from '@hakit/contracts/fixtures';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { commit, isGuardFailure, requireChanged, schema } from '../index';
import { createTestDb } from '../testing';
import { seedSql } from './sql';

const slugs = new Set(SKILLS.map((s) => s.slug));

describe('seed data integrity', () => {
  it('skill slugs are unique', () => expect(slugs.size).toBe(SKILLS.length));
  it('related skills exist', () => {
    for (const s of SKILLS) for (const r of s.related ?? []) expect(slugs, `${s.slug} → ${r}`).toContain(r);
  });
  it('challenge requiredTech references real skills', () => {
    for (const h of HACKATHONS)
      for (const c of h.challenges)
        for (const t of c.requiredTech) expect(slugs, `${c.key} → ${t}`).toContain(t);
  });
  it('contract fixtures only use real skill slugs', () => {
    const used = [
      ...fx.members.flatMap((m) => m.topSkills.map((s) => s.slug)),
      ...fx.tasks.flatMap((t) => t.requiredSkills.map((s) => s.skillSlug)),
      ...fx.planDocument.tasks.flatMap((t) => t.requiredSkills.map((s) => s.slug)),
    ];
    for (const u of used) expect(slugs, u).toContain(u);
  });
});

describe('D1 migrations', () => {
  it('apply cleanly and seed every skill and event template', async () => {
    const { db } = createTestDb({ seed: true });
    expect(await db.$count(schema.skills)).toBe(SKILLS.length);
    expect(await db.$count(schema.hackathonTemplates)).toBe(HACKATHONS.length);
    expect(await db.$count(schema.challenges)).toBe(HACKATHONS.reduce((n, h) => n + h.challenges.length, 0));
    const [skill] = await db.select().from(schema.skills).limit(1);
    expect(skill!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Array.isArray(skill!.aliases)).toBe(true);
  });

  it('the seed migration is what the generator renders', () => {
    const file = readFileSync(new URL('../../migrations/0002_seed.sql', import.meta.url), 'utf8');
    expect(file).toBe(seedSql());
  });

  it('behaves like D1: no SQL transactions, 100 parameters max, atomic batches', async () => {
    const { db } = createTestDb({ seed: true });
    const cause = (p: Promise<unknown>) =>
      p.then(
        () => '',
        (e: { cause?: Error }) => e.cause?.message ?? '',
      );
    expect(await cause(db.transaction(async () => {}))).toMatch(/use db.batch/);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      slug: `x${i}`,
      name: 'X',
      category: 'data' as const,
    }));
    expect(await cause(db.insert(schema.skills).values(rows))).toMatch(/too many SQL variables/);
    const before = await db.$count(schema.skills);
    await expect(
      db.batch([
        db.insert(schema.skills).values({ slug: 'new-one', name: 'N', category: 'data' }),
        db.insert(schema.skills).values({ slug: 'typescript', name: 'dup', category: 'data' }),
      ]),
    ).rejects.toThrow();
    expect(await db.$count(schema.skills)).toBe(before);
  });
});

describe('requireChanged', () => {
  it('rolls the batch back when the guarded update matched nothing', async () => {
    const { db } = createTestDb({ seed: true });
    const update = (from: string, to: string) =>
      db.update(schema.skills).set({ name: to }).where(eq(schema.skills.name, from));
    await commit(db, [update('TypeScript', 'TS'), requireChanged(db), update('Python', 'Py')]);
    expect((await db.select().from(schema.skills).where(eq(schema.skills.name, 'Py'))).length).toBe(1);
    const failed = await commit(db, [update('nope', 'x'), requireChanged(db), update('Py', 'Python')]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isGuardFailure(failed)).toBe(true);
    expect((await db.select().from(schema.skills).where(eq(schema.skills.name, 'Py'))).length).toBe(1);
  });
});
