import { describe, expect, it } from 'vitest';
import {
  ActivityEvent,
  AgentSession,
  HackathonTemplate,
  IdeaCandidate,
  Member,
  MemberSkill,
  MissionControlSnapshot,
  PlanDocument,
  PlanOutline,
  ProjectBoard,
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
    ['recommendation', Recommendation, fx.stallRecommendation],
    ['missionControl', MissionControlSnapshot, fx.missionControl],
  ];
  it.each(cases)('%s', (_name, schema, value) => {
    expect(() => schema.parse(value)).not.toThrow();
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
