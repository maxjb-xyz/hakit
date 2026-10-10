import { z } from 'zod';
import { GithubId, Id, SkillSlug, Timestamp } from './common';

export const User = z.object({
  id: Id,
  githubUserId: GithubId,
  githubLogin: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.url().nullable(),
});
export type User = z.infer<typeof User>;

export const Role = z.enum(['owner', 'member']);
export type Role = z.infer<typeof Role>;

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  slug: z.string(),
  hackathonTemplateId: Id.nullable(),
  startsAt: Timestamp.nullable(),
  deadlineAt: Timestamp,
  createdAt: Timestamp,
  /** Slug of `hackathonTemplateId`, for `getHackathon` (additive; set by getWorkspace). */
  hackathonSlug: z.string().nullable().optional(),
});
export type Workspace = z.infer<typeof Workspace>;

export const Membership = z.object({
  workspaceId: Id,
  userId: Id,
  role: Role,
  /** Index into the 8-hue member palette (DESIGN §2.4). */
  colorIndex: z.number().int().min(0).max(7),
  joinedAt: Timestamp,
});
export type Membership = z.infer<typeof Membership>;

export const Me = z.object({
  user: User,
  memberships: z.array(Membership.extend({ workspaceName: z.string() })),
});
export type Me = z.infer<typeof Me>;

export const CreateWorkspace = z.object({
  name: z.string().min(1).max(80),
  hackathonSlug: z.string().optional(),
  /** Required when no hackathon template is chosen. */
  deadlineAt: Timestamp.optional(),
  startsAt: Timestamp.optional(),
});
export type CreateWorkspace = z.infer<typeof CreateWorkspace>;

export const UpdateWorkspace = CreateWorkspace.partial();
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>;

export const CreateInvite = z.object({
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(72),
  maxUses: z.number().int().min(1).max(50).nullable().default(null),
});
export type CreateInvite = z.infer<typeof CreateInvite>;

export const Invite = z.object({
  id: Id,
  code: z.string(),
  url: z.url(),
  expiresAt: Timestamp,
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
});
export type Invite = z.infer<typeof Invite>;

export const InvitePreview = z.object({
  workspaceName: z.string(),
  memberAvatars: z.array(z.object({ login: z.string(), avatarUrl: z.url().nullable() })),
  expired: z.boolean(),
  /** The invite's workspace, so a signed-in visitor can tell they're already a member (additive). */
  workspaceId: Id.optional(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

export const AvailabilityWindow = z.object({
  start: Timestamp,
  end: Timestamp,
  kind: z.enum(['available', 'sleep', 'away']),
});
export type AvailabilityWindow = z.infer<typeof AvailabilityWindow>;

export const MemberProfile = z.object({
  userId: Id,
  workspaceId: Id,
  headline: z.string().max(120).nullable(),
  timezone: z.string(),
  interests: z.array(z.string().max(60)).max(20),
  learningGoals: z.array(SkillSlug).max(10),
  avoid: z.array(SkillSlug).max(10),
  availability: z.array(AvailabilityWindow),
  /** Derived server-side from availability ∩ event window. */
  availableHours: z.number().nonnegative(),
  onboardingCompletedAt: Timestamp.nullable(),
});
export type MemberProfile = z.infer<typeof MemberProfile>;

export const UpdateMemberProfile = MemberProfile.pick({
  headline: true,
  timezone: true,
  interests: true,
  learningGoals: true,
  avoid: true,
  availability: true,
})
  .partial()
  .extend({
    /** Marks onboarding finished (sets onboardingCompletedAt once; additive). */
    completeOnboarding: z.literal(true).optional(),
  });
export type UpdateMemberProfile = z.infer<typeof UpdateMemberProfile>;

/** Row in the team list: profile + skill summary + what they're on now. */
export const Member = z.object({
  user: User,
  role: Role,
  colorIndex: z.number().int().min(0).max(7),
  profile: MemberProfile,
  topSkills: z.array(
    z.object({ slug: SkillSlug, level: z.number().int().min(1).max(5), confirmed: z.boolean() }),
  ),
  currentTaskId: Id.nullable(),
});
export type Member = z.infer<typeof Member>;
