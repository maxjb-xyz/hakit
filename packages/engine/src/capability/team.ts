/** Deterministic capability profile, docs/AI.md §A.3. No model, DB or clock reads. */
import {
  AvailabilityWindow,
  Confidence,
  Id,
  SkillCategory,
  SkillLevel,
  type TeamCapability,
} from '@hakit/contracts';
import type { EngineMember, EngineSkill } from '../types';
import { DEFAULT_CONFIG } from '../config';
const HOUR = 3_600_000;
const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
export function computeTeamCapability(
  workspaceId: string,
  members: EngineMember[],
  taxonomy: Map<string, EngineSkill>,
  event: { startsAt: Date; endsAt: Date },
  focusFactor = DEFAULT_CONFIG.focusFactor,
): TeamCapability {
  Id.parse(workspaceId);
  const start = event.startsAt.getTime(),
    end = event.endsAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new RangeError('Event must have a valid start before its end');
  if (Math.ceil((end - start) / (2 * HOUR)) > 4096)
    throw new RangeError('Event is too long for the capability curve (maximum 4096 buckets)');
  if (!Number.isFinite(focusFactor) || focusFactor < 0 || focusFactor > 1)
    throw new RangeError('Focus factor must be between 0 and 1');
  const memberIds = new Set<string>();
  const prepared = members.map((member) => {
    Id.parse(member.userId);
    if (memberIds.has(member.userId)) throw new RangeError('Duplicate team member');
    memberIds.add(member.userId);
    const skills = new Map<string, number>();
    for (const skill of member.skills) {
      SkillLevel.parse(skill.level);
      Confidence.parse(skill.confidence);
      if (taxonomy.has(skill.slug))
        skills.set(skill.slug, Math.max(skills.get(skill.slug) ?? 0, skill.level * skill.confidence));
    }
    const windows = AvailabilityWindow.array()
      .parse(member.availability)
      .map((w) => ({ kind: w.kind, start: Date.parse(w.start), end: Date.parse(w.end) }))
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < windows.length; i++)
      if (windows[i]!.end <= windows[i]!.start || (i > 0 && windows[i]!.start < windows[i - 1]!.end))
        throw new RangeError('Availability windows must be ordered, non-overlapping intervals');
    return { userId: member.userId, skills, windows };
  });
  const categories = SkillCategory.options.map((category) => {
    const topMembers = prepared
      .map((member) => ({
        userId: member.userId,
        effectiveLevel: Math.max(
          0,
          ...[...member.skills]
            .filter(([slug]) => taxonomy.get(slug)!.category === category)
            .map(([, level]) => level),
        ),
      }))
      .filter((m) => m.effectiveLevel > 0)
      .sort((a, b) => b.effectiveLevel - a.effectiveLevel || a.userId.localeCompare(b.userId));
    const coverage = topMembers[0]?.effectiveLevel ?? 0;
    return {
      category,
      coverage,
      label:
        coverage >= 3.5
          ? ('strong' as const)
          : coverage >= 2.5
            ? ('adequate' as const)
            : coverage >= 1.5
              ? ('thin' as const)
              : ('gap' as const),
      busFactor: topMembers.filter((m) => m.effectiveLevel >= 3).length,
      topMembers,
    };
  });
  const overlaps = [...taxonomy.keys()].sort().flatMap((skillSlug) => {
    const userIds = prepared
      .filter((m) => (m.skills.get(skillSlug) ?? 0) >= 3)
      .map((m) => m.userId)
      .sort();
    return userIds.length >= 3 ? [{ skillSlug, userIds }] : [];
  });
  const availabilityCurve: Array<{ bucketStart: string; hours: number }> = [];
  for (let bucket = start; bucket < end; bucket += 2 * HOUR) {
    const bucketEnd = Math.min(bucket + 2 * HOUR, end);
    const hours = prepared.reduce(
      (sum, m) =>
        sum +
        m.windows
          .filter((w) => w.kind === 'available')
          .reduce(
            (n, w) => n + Math.max(0, Math.min(w.end, bucketEnd) - Math.max(w.start, bucket)) / HOUR,
            0,
          ),
      0,
    );
    availabilityCurve.push({ bucketStart: new Date(bucket).toISOString(), hours: round(hours) });
  }
  const totalAvailableHours = round(availabilityCurve.reduce((sum, b) => sum + b.hours, 0));
  return {
    workspaceId,
    categories,
    gaps: categories
      .filter((c) => c.label === 'gap')
      .map((c) => ({
        category: c.category,
        note:
          c.coverage === 0
            ? 'No reported skills in this category'
            : 'Reported skills have low effective coverage in this category',
      })),
    overlaps,
    availabilityCurve,
    totalAvailableHours,
    totalEffectiveHours: round(totalAvailableHours * focusFactor),
    aiSummary: null,
  };
}
