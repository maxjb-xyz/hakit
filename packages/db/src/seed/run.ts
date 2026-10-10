/**
 * Idempotent seed: skill taxonomy + hackathon templates. Run by the PL owner: `pnpm db:seed`.
 * Embeddings are NOT computed here; the worker's `embed.batch` job fills skills.embedding.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '../index';
import { SKILLS } from './skills';
import { HACKATHONS } from './hackathons';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required (Tiger direct service URL)');

const { db, ready, close } = createDb(url);
await ready;

for (const s of SKILLS) {
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
}
console.log(`skills: ${SKILLS.length}`);

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
    .onConflictDoUpdate({
      target: schema.hackathonTemplates.slug,
      set: {
        name: h.name,
        startsAt: new Date(h.startsAt),
        endsAt: new Date(h.endsAt),
        tracks: h.tracks,
        judgingCriteria: h.judgingCriteria,
      },
    })
    .returning({ id: schema.hackathonTemplates.id });
  for (const c of h.challenges) {
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
      .onConflictDoUpdate({
        target: [schema.challenges.hackathonTemplateId, schema.challenges.key],
        set: {
          sponsor: c.sponsor,
          title: c.title,
          requirements: [...c.requirements],
          requiredTech: [...c.requiredTech],
        },
      });
  }
  console.log(`hackathon: ${h.slug} (${h.challenges.length} challenges)`);
}

const [{ n }] = (await db.execute(sql`select count(*)::int as n from skills where embedding is null`))
  .rows as [{ n: number }];
console.log(`skills awaiting embeddings: ${n} (filled by the embed.batch job)`);
await close();
