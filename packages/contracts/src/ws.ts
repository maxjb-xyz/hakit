import { z } from 'zod';
import { Id, Timestamp } from './common';
import { ActivityEvent } from './activity';
import { AgentSession } from './agents';
import { Assignment } from './assignment';
import { SkillImportProgress } from './capability';
import { Health } from './mission-control';
import { Recommendation } from './recommendations';
import { Task } from './tasks';

/**
 * Server → client messages from the ProjectRoom Durable Object (ARCHITECTURE §7).
 * No mutations travel over WS; clients use REST and treat these as cache invalidations/patches.
 */
export const WsPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('activity.created'), data: z.object({ event: ActivityEvent }) }),
  z.object({
    type: z.literal('task.updated'),
    data: z.object({ task: Task, assignment: Assignment.nullable() }),
  }),
  z.object({ type: z.literal('board.changed'), data: z.object({ reason: z.string() }) }),
  z.object({ type: z.literal('recommendation.created'), data: z.object({ recommendation: Recommendation }) }),
  z.object({
    type: z.literal('recommendation.resolved'),
    data: z.object({ recommendation: Recommendation }),
  }),
  z.object({ type: z.literal('agent_session.updated'), data: z.object({ session: AgentSession }) }),
  z.object({ type: z.literal('presence'), data: z.object({ userIds: z.array(Id) }) }),
  z.object({
    type: z.literal('plan.progress'),
    data: z.object({ planId: Id.nullable(), stage: z.string() }),
  }),
  z.object({ type: z.literal('health.updated'), data: z.object({ health: Health }) }),
  z.object({
    type: z.literal('skills.import_progress'),
    data: z.object({ userId: Id, progress: SkillImportProgress }),
  }),
  z.object({ type: z.literal('member.joined'), data: z.object({ userId: Id }) }),
]);
export type WsPayload = z.infer<typeof WsPayload>;
export type WsEventType = WsPayload['type'];

export const WsEnvelope = z.intersection(
  z.object({ v: z.literal(1), seq: z.number().int().nonnegative(), at: Timestamp }),
  WsPayload,
);
export type WsEnvelope = z.infer<typeof WsEnvelope>;

/** Client → server. */
export const WsClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), lastSeq: z.number().int().nonnegative().nullable() }),
  z.object({ type: z.literal('ping') }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;
