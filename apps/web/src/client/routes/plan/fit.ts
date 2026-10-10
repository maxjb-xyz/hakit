/**
 * S7 constraint fit meter (T-302): deterministic coverage of the required tech by the team, checked against the
 * current idea. No model involved: ✓ satisfied (someone is level 3+), ⚠ risky (skill gap or only a beginner),
 * ✗ conflicting (required and excluded at once, or the idea's stack uses excluded tech).
 */
import type { Member } from '@hakit/contracts';

export type FitState = 'satisfied' | 'risky' | 'conflict';
export interface FitItem {
  tech: string;
  state: FitState;
  reason: string;
  /** Members who know it, strongest first. */
  userIds: string[];
}
export interface Fit {
  items: FitItem[];
  satisfied: number;
  /** satisfied / items, 0..1; 1 when nothing is required. */
  score: number;
}

/** "Cloudflare Workers" and "cloudflare-workers" are the same requirement. */
export const normTech = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+#]+/g, '-')
    .replace(/^-|-$/g, '');

const PROFICIENT = 3;

export function constraintFit(input: {
  requiredTech: string[];
  excludedTech: string[];
  ideaStack: string[];
  members: Pick<Member, 'user' | 'topSkills'>[];
}): Fit {
  const excluded = new Set(input.excludedTech.map(normTech));
  const seen = new Set<string>();
  const items: FitItem[] = [];
  for (const raw of input.requiredTech) {
    const tech = normTech(raw);
    if (!tech || seen.has(tech)) continue;
    seen.add(tech);
    const who = input.members
      .flatMap((m) =>
        m.topSkills.filter((s) => s.slug === tech).map((s) => ({ id: m.user.id, level: s.level })),
      )
      .sort((a, b) => b.level - a.level);
    const best = who[0]?.level ?? 0;
    const userIds = who.map((w) => w.id);
    if (excluded.has(tech)) items.push({ tech, state: 'conflict', reason: 'Required and excluded', userIds });
    else if (best >= PROFICIENT)
      items.push({
        tech,
        state: 'satisfied',
        reason: `${who.filter((w) => w.level >= PROFICIENT).length} at level 3+`,
        userIds,
      });
    else if (best > 0) items.push({ tech, state: 'risky', reason: `Best is level ${best}`, userIds });
    else items.push({ tech, state: 'risky', reason: 'No one on the team has it', userIds });
  }
  for (const raw of input.ideaStack) {
    const tech = normTech(raw);
    if (!excluded.has(tech) || seen.has(tech)) continue;
    seen.add(tech);
    items.push({ tech, state: 'conflict', reason: 'The idea uses excluded tech', userIds: [] });
  }
  const satisfied = items.filter((i) => i.state === 'satisfied').length;
  return { items, satisfied, score: items.length ? satisfied / items.length : 1 };
}
