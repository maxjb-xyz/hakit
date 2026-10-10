import type { IdeaCandidate } from '@hakit/contracts';

/** Mean coverage of distinct stack skills at effective level 3; empty stack is unknown (0). */
export function ideaTeamFit(candidate: IdeaCandidate, levels: Map<string, number>): number {
  const slugs = new Set(candidate.stack.flatMap((component) => component.skillSlugs));
  if (!slugs.size) return 0;
  let sum = 0;
  for (const slug of slugs) {
    const level = levels.get(slug) ?? 0;
    if (!Number.isFinite(level) || level < 0 || level > 5)
      throw new RangeError('Invalid effective skill level');
    sum += Math.min(level / 3, 1);
  }
  return Math.round((sum / slugs.size) * 1_000_000) / 1_000_000;
}
