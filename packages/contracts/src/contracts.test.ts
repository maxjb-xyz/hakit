import { describe, expect, it } from 'vitest';
import {
  ActivityEvent,
  AgentSession,
  AgentTokenSummary,
  AiUsage,
  HackathonTemplate,
  IdeaCandidate,
  Member,
  MemberSkill,
  MissionControlSnapshot,
  PlanDocument,
  PlanOutline,
  ProjectBoard,
  PutConstraints,
  Recommendation,
  TaskDrafts,
  TeamCapability,
  Workspace,
  WsEnvelope,
  buildPath,
  endpoints,
  toGeminiSchema,
} from './index';
import * as fx from './fixtures';

describe('fixtures match their schemas', () => {
  const cases: [string, { parse: (v: unknown) => unknown }, unknown][] = [
    ['hackathon', HackathonTemplate, fx.knightHacksIX],
    ['workspace', Workspace, fx.workspace],
    ['members', Member.array(), fx.members],
    ['memberSkills', MemberSkill.array(), fx.priyaSkills],
    ['capability', TeamCapability, fx.teamCapability],
    ['plan', PlanDocument, fx.planDocument],
    ['board', ProjectBoard, fx.board],
    ['activity', ActivityEvent.array(), fx.activity],
    ['agentSessions', AgentSession.array(), fx.agentSessions],
    ['recommendations', Recommendation.array(), fx.recommendations],
    ['agentTokens', AgentTokenSummary.array(), fx.agentTokens],
    ['constraints', PutConstraints, fx.constraints],
    ['missionControl', MissionControlSnapshot, fx.missionControl],
    ['aiUsage', AiUsage, fx.aiUsage],
  ];
  it.each(cases)('%s', (_name, schema, value) => {
    expect(() => schema.parse(value)).not.toThrow();
  });
});

describe('fixtures tell one consistent story', () => {
  const taskIds = new Set(fx.tasks.map((t) => t.id));
  const userIds = new Set(fx.members.map((m) => m.user.id));
  const sessionIds = new Set(fx.agentSessions.map((s) => s.id));

  it('activity points at real tasks, members and sessions', () => {
    expect(new Set(fx.activity.map((a) => a.id)).size).toBe(fx.activity.length);
    for (const a of fx.activity) {
      if (a.taskId) expect(taskIds.has(a.taskId), a.title).toBe(true);
      if (a.actorUserId) expect(userIds.has(a.actorUserId), a.title).toBe(true);
      else expect(a.actorRaw, a.title).not.toBeNull();
      if (a.agentSessionId) expect(sessionIds.has(a.agentSessionId), a.title).toBe(true);
      expect(a.linkKind === 'none', a.title).toBe(a.taskId === null);
      expect(a.linkKind === 'inferred', a.title).toBe(a.linkConfidence !== null);
    }
    // The demo needs each link kind and an author nobody has mapped yet.
    expect(new Set(fx.activity.map((a) => a.linkKind))).toEqual(new Set(['confirmed', 'inferred', 'none']));
    expect(fx.activity.some((a) => a.source === 'github' && a.actorUserId === null)).toBe(true);
    expect(fx.activity.filter((a) => a.kind.startsWith('pr_')).map((a) => a.kind)).toEqual(
      expect.arrayContaining(['pr_opened', 'pr_merged', 'pr_review']),
    );
  });

  it('feed is newest first', () => {
    const ts = fx.activityFeed.map((a) => Date.parse(a.ts));
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
    expect(fx.missionControl.recentActivity.map((a) => a.id)).toEqual(fx.activityFeed.map((a) => a.id));
  });

  it('sessions, lanes and recommendations agree with the board', () => {
    expect(new Set(fx.agentSessions.map((s) => s.status)).size).toBeGreaterThanOrEqual(3);
    for (const s of fx.agentSessions) {
      expect(userIds.has(s.userId)).toBe(true);
      if (s.taskId) expect(taskIds.has(s.taskId)).toBe(true);
    }
    for (const lane of fx.missionControl.lanes)
      for (const s of lane.agentSessions)
        expect(fx.agentSessions.find((x) => x.id === s.id)?.userId).toBe(lane.userId);
    for (const r of fx.recommendations)
      for (const a of r.actions) {
        if ('taskId' in a) expect(taskIds.has(a.taskId)).toBe(true);
        if (a.op === 'reassign') expect(userIds.has(a.toUserId)).toBe(true);
      }
    expect(fx.missionControl.openRecommendations).toEqual(fx.recommendations);
    expect(new Set(fx.recommendations.map((r) => r.id)).size).toBe(fx.recommendations.length);
  });
});

describe('ws envelope', () => {
  it('parses a typed event', () => {
    const msg = WsEnvelope.parse({
      v: 1,
      seq: 3,
      at: '2026-10-10T11:00:00-04:00',
      type: 'board.changed',
      data: { reason: 'plan accepted' },
    });
    expect(msg.type).toBe('board.changed');
  });
});

describe('api registry', () => {
  it('has unique method+path pairs', () => {
    const keys = Object.values(endpoints).map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('builds paths', () => {
    expect(buildPath(endpoints.acceptPlan.path, { pid: 'p1', planId: 'v2' })).toBe(
      '/projects/p1/plans/v2/accept',
    );
    expect(() => buildPath('/tasks/:tid', {})).toThrow();
  });
});

describe('gemini schemas', () => {
  it.each([
    ['IdeaCandidate', IdeaCandidate],
    ['PlanOutline', PlanOutline],
    ['TaskDrafts', TaskDrafts],
  ])('%s converts without unsupported keys', (_n, schema) => {
    const json = JSON.stringify(toGeminiSchema(schema));
    expect(json).not.toContain('$schema');
    expect(json).not.toContain('additionalProperties');
    expect(json).toContain('"type":"object"');
  });
});
