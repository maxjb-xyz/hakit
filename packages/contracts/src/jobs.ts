import { z } from 'zod';
import { GithubId, Id } from './common';
import { AgentHookEvent } from './agents';

/** Messages on the `hakit-jobs` queue (ARCHITECTURE §8). One handler per `type` in apps/web/src/worker/jobs. */
export const JobMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('github.webhook'),
    deliveryId: z.string(),
    event: z.string(),
    /** Raw JSON body (already signature-verified). */
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal('github.backfill'),
    projectId: Id,
    repoId: GithubId,
    sinceHours: z.number().default(48),
  }),
  z.object({
    type: z.literal('skills.import'),
    userId: Id,
    workspaceId: Id,
    /** Import is split into chunks of repos to stay under subrequest limits. */
    repoCursor: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal('embed.batch'),
    target: z.enum(['task', 'member', 'skill']),
    ids: z.array(z.string()).min(1).max(100),
  }),
  z.object({ type: z.literal('activity.link'), eventId: Id, projectId: Id }),
  z.object({
    type: z.literal('agent.event'),
    tokenId: Id,
    userId: Id,
    workspaceId: Id,
    event: AgentHookEvent,
  }),
  z.object({
    type: z.literal('recs.evaluate'),
    projectId: Id,
    reason: z.enum(['cron', 'board_change', 'activity']),
  }),
]);
export type JobMessage = z.infer<typeof JobMessage>;
export type JobType = JobMessage['type'];
