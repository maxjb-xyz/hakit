import { z } from 'zod';

/** UUID primary keys (Postgres gen_random_uuid). */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** ISO-8601 timestamp with offset, as serialized over the wire. */
export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** GitHub numeric IDs exceed 2^31; keep them as numbers (safe < 2^53). */
export const GithubId = z.number().int().nonnegative();

/** Human task key, e.g. "HK-12". */
export const TaskKey = z.string().regex(/^HK-\d+$/);
export type TaskKey = z.infer<typeof TaskKey>;

/** Skill taxonomy slug, e.g. "react", "cloudflare-workers". */
export const SkillSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export type SkillSlug = z.infer<typeof SkillSlug>;

/** Every derived number shown in the UI says whether it was measured or estimated (PRODUCT §6). */
export const Measure = z.enum(['measured', 'estimated']);
export type Measure = z.infer<typeof Measure>;

/** Activity↔task and session↔task link provenance (PRODUCT §6). */
export const LinkKind = z.enum(['confirmed', 'inferred', 'none']);
export type LinkKind = z.infer<typeof LinkKind>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export type Page<T> = { items: T[]; nextCursor: string | null };

export const JobAccepted = z.object({ jobId: z.string() });
export type JobAccepted = z.infer<typeof JobAccepted>;
