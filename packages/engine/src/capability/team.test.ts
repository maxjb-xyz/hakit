import { describe, expect, it } from 'vitest';
import { TeamCapability } from '@hakit/contracts';
import { computeTeamCapability } from './team';
import type { EngineMember } from '../types';
const wid = '00000000-0000-4000-8000-000000000001';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = { startsAt: new Date('2026-10-10T00:00:00Z'), endsAt: new Date('2026-10-10T05:00:00Z') };
const taxonomy = new Map([
  ['react', { slug: 'react', category: 'frontend' as const, related: [] }],
  ['typescript', { slug: 'typescript', category: 'frontend' as const, related: [] }],
  ['python', { slug: 'python', category: 'backend' as const, related: [] }],
]);
const member = (n = 2, level = 4, confidence = 1): EngineMember => ({
  userId: uid(n),
  skills: [{ slug: 'react', level, confidence, confirmed: true }],
  learningGoals: [],
  avoid: [],
  availability: [{ start: '2026-10-10T00:00:00Z', end: '2026-10-10T05:00:00Z', kind: 'available' }],
  availableHours: 5,
  profileEmbedding: null,
  interestsEmbedding: null,
});
const frontend = (members: EngineMember[]) =>
  computeTeamCapability(wid, members, taxonomy, event).categories.find((c) => c.category === 'frontend')!;
describe('team capability', () => {
  it('returns a valid empty-team profile with all categories and gaps', () => {
    const result = computeTeamCapability(wid, [], taxonomy, event);
    expect(TeamCapability.safeParse(result).success).toBe(true);
    expect(result.categories).toHaveLength(11);
    expect(result.gaps).toHaveLength(11);
    expect(result.totalEffectiveHours).toBe(0);
    expect(result.aiSummary).toBeNull();
  });
  it.each([
    [5, 0.7, 'strong'],
    [5, 0.5, 'adequate'],
    [3, 0.5, 'thin'],
    [1, 1, 'gap'],
  ] as const)('labels level %s confidence %s as %s', (level, confidence, label) => {
    expect(frontend([member(2, level, confidence)])).toMatchObject({ coverage: level * confidence, label });
  });
  it('counts skilled members once per category, not once per skill', () => {
    const a = member();
    a.skills.push({ slug: 'typescript', level: 5, confidence: 1, confirmed: true });
    expect(frontend([a, member(3, 3, 1), member(4, 5, 0.4)])).toMatchObject({ coverage: 5, busFactor: 2 });
  });
  it('requires three effective-level-three members for overlap', () => {
    const result = computeTeamCapability(
      wid,
      [member(4, 3), member(3, 5, 0.6), member(2, 4)],
      taxonomy,
      event,
    );
    expect(result.overlaps).toEqual([{ skillSlug: 'react', userIds: [uid(2), uid(3), uid(4)] }]);
    expect(computeTeamCapability(wid, [member(2), member(3)], taxonomy, event).overlaps).toEqual([]);
  });
  it('sorts ties and produces identical results when member order changes', () => {
    const a = computeTeamCapability(wid, [member(3), member(2)], taxonomy, event);
    const b = computeTeamCapability(wid, [member(2), member(3)], taxonomy, event);
    expect(a).toEqual(b);
    expect(a.categories[0]!.topMembers[0]!.userId).toBe(uid(2));
  });
  it('uses the highest duplicate skill score and ignores unknown taxonomy skills', () => {
    const a = member();
    a.skills.push(
      { slug: 'react', level: 2, confidence: 1, confirmed: true },
      { slug: 'unknown', level: 5, confidence: 1, confirmed: true },
    );
    expect(frontend([a]).coverage).toBe(4);
  });
  it('clips windows to the event and includes the final partial bucket', () => {
    const a = member();
    a.availability = [
      { start: '2026-10-09T23:00:00Z', end: '2026-10-10T01:00:00Z', kind: 'available' },
      { start: '2026-10-10T04:00:00Z', end: '2026-10-10T06:00:00Z', kind: 'available' },
    ];
    const r = computeTeamCapability(wid, [a], taxonomy, event);
    expect(r.availabilityCurve.map((b) => b.hours)).toEqual([1, 0, 1]);
    expect(r.totalAvailableHours).toBe(2);
    expect(r.totalEffectiveHours).toBe(1.4);
  });
  it('counts only available windows and derives hours from intervals', () => {
    const a = member();
    a.availableHours = 999;
    a.availability = [
      { start: '2026-10-10T00:00:00Z', end: '2026-10-10T01:00:00Z', kind: 'sleep' },
      { start: '2026-10-10T01:00:00Z', end: '2026-10-10T02:00:00Z', kind: 'away' },
      { start: '2026-10-10T02:00:00Z', end: '2026-10-10T03:00:00Z', kind: 'available' },
    ];
    expect(computeTeamCapability(wid, [a], taxonomy, event).totalAvailableHours).toBe(1);
  });
  it('adds simultaneous members and supports a configurable focus factor', () => {
    const r = computeTeamCapability(wid, [member(2), member(3)], taxonomy, event, 0.5);
    expect(r.availabilityCurve.map((b) => b.hours)).toEqual([4, 4, 2]);
    expect(r.totalAvailableHours).toBe(10);
    expect(r.totalEffectiveHours).toBe(5);
  });
  it('handles members without availability without fabricating hours', () => {
    const a = member();
    a.availability = [];
    expect(computeTeamCapability(wid, [a], taxonomy, event).totalAvailableHours).toBe(0);
  });
  it('does not mutate members, taxonomy or availability', () => {
    const a = member();
    const before = JSON.stringify(a);
    computeTeamCapability(wid, [a], taxonomy, event);
    expect(JSON.stringify(a)).toBe(before);
    expect(taxonomy.size).toBe(3);
  });
  it('rejects duplicate members and invalid levels or confidence', () => {
    expect(() => computeTeamCapability(wid, [member(2), member(2)], taxonomy, event)).toThrow('Duplicate');
    expect(() => frontend([member(2, 6)])).toThrow();
    expect(() => frontend([member(2, 4, NaN)])).toThrow();
  });
  it('rejects invalid, reversed and excessive event windows', () => {
    expect(() =>
      computeTeamCapability(wid, [], taxonomy, { ...event, startsAt: new Date('invalid') }),
    ).toThrow();
    expect(() =>
      computeTeamCapability(wid, [], taxonomy, { startsAt: event.endsAt, endsAt: event.startsAt }),
    ).toThrow();
    expect(() =>
      computeTeamCapability(wid, [], taxonomy, { ...event, endsAt: new Date('2099-01-01') }),
    ).toThrow('4096');
  });
  it('rejects invalid focus factors and overlapping or reversed availability', () => {
    expect(() => computeTeamCapability(wid, [], taxonomy, event, 2)).toThrow('Focus factor');
    const a = member();
    a.availability.push({ ...a.availability[0]! });
    expect(() => frontend([a])).toThrow('non-overlapping');
    a.availability = [{ start: '2026-10-10T02:00:00Z', end: '2026-10-10T01:00:00Z', kind: 'available' }];
    expect(() => frontend([a])).toThrow('intervals');
  });
});
