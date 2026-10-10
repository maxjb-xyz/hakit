import type { RepoSummary } from '@hakit/contracts';

/** GitHub access used by routes/jobs (docs/INTEGRATIONS.md §1). Owner: GH (+ PL for OAuth). */
export interface GithubService {
  /** OAuth web flow (T-201). */
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GithubTokenSet>;
  /** Rotate a user token pair. Throws GithubAuthError('bad_refresh_token') when revoked or expired. */
  refreshToken(refreshToken: string): Promise<GithubTokenSet>;
  getUser(accessToken: string): Promise<{
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    email: string | null;
  }>;
  /** Repos visible through the user's installations (T-402). */
  listInstallationRepos(userAccessToken: string): Promise<RepoSummary[]>;
  /** Verify a Setup URL installation_id belongs to the user (T-402). */
  userHasInstallation(userAccessToken: string, installationId: number): Promise<boolean>;
  /** HMAC-SHA256 over the raw body (T-401). */
  verifyWebhook(rawBody: string, signature256: string | null): Promise<boolean>;
  installUrl(state: string): string;
}

export interface GithubTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds; null when the app has expiring tokens disabled. */
  expiresIn: number | null;
  refreshTokenExpiresIn: number | null;
}

/** OAuth-level failure reported by GitHub (`error` in a 200 body), e.g. bad_verification_code, bad_refresh_token. */
export class GithubAuthError extends Error {
  constructor(readonly code: string) {
    super(`GitHub OAuth error: ${code}`);
  }
}
