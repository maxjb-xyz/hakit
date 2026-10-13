import { z } from 'zod';

/** First-run state of a self-hosted instance (GET /setup). Public: it reveals no secret values. */
export const SetupStatus = z.object({
  /** Where the GitHub App comes from: wrangler secrets, the /setup flow, or nowhere yet. */
  github: z.enum(['env', 'stored', 'missing']),
  /** Slug of the configured App, for its github.com/apps/<slug> page. */
  githubAppSlug: z.string().nullable(),
  secrets: z.object({ sessionSecret: z.boolean(), tokenEncKey: z.boolean() }),
});
export type SetupStatus = z.infer<typeof SetupStatus>;

/**
 * Start the GitHub App manifest flow. `setupKey` is the instance's SESSION_SECRET, proving the caller deployed
 * it; `organization` creates the App under that GitHub organization instead of the caller's account.
 */
export const StartGithubSetup = z.object({
  setupKey: z.string().min(1).max(512),
  organization: z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
    .optional(),
});
export type StartGithubSetup = z.infer<typeof StartGithubSetup>;

/** The browser POSTs `manifest` as a form field to `action` (github.com), which hands back to the callback. */
export const GithubManifestForm = z.object({ action: z.string().url(), manifest: z.string() });
export type GithubManifestForm = z.infer<typeof GithubManifestForm>;
