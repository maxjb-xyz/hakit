import { describe, expect, it } from 'vitest';
import { SKILLS } from './skills';
import { HACKATHONS } from './hackathons';
import * as fx from '@hakit/contracts/fixtures';

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
