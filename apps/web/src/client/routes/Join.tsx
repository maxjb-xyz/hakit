/**
 * S2 Invite landing `/j/:code` (DESIGN §8, T-207). Works signed out: shows the team from `previewInvite`,
 * then GitHub sign-in (returning here) or, when signed in, `acceptInvite` → onboarding for that workspace.
 */
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_PREFIX } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api, ApiRequestError } from '../lib/api';
import { qk } from '../lib/query';
import { Card, PersonAvatar, isNotFound } from './people/shared';

const linkButton =
  'inline-flex h-control-xl w-full items-center justify-center rounded-md bg-accent-500 px-5 text-body-lg font-medium text-strong transition-colors duration-(--duration-instant) hover:bg-accent-600 active:bg-accent-600';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6 max-sm:p-4">
      <div className="w-full max-w-md">
        <p className="mb-4 font-display text-title text-strong">hakit</p>
        {children}
      </div>
    </main>
  );
}

export function Join() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: qk('previewInvite', { code }),
    queryFn: () => api('previewInvite', { params: { code } }),
    retry: (n, e) => !isNotFound(e) && n < 1,
  });
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const accept = useMutation({
    mutationFn: () => api('acceptInvite', { params: { code }, body: {} }),
    onSuccess: (w) => {
      void qc.invalidateQueries({ queryKey: qk('me') });
      navigate(`/onboarding?wid=${encodeURIComponent(w.id)}`);
    },
  });

  if (preview.isPending)
    return (
      <Frame>
        <div
          className="h-64 animate-pulse rounded-md border border-border bg-surface"
          aria-busy="true"
          aria-label="Loading invite"
        />
      </Frame>
    );

  if (preview.isError)
    return (
      <Frame>
        <Card>
          <h1 className="text-title font-medium text-strong">
            {isNotFound(preview.error) ? "This invite link doesn't work" : "Couldn't open this invite"}
          </h1>
          <p className="mt-2 text-body text-muted">
            {isNotFound(preview.error)
              ? 'Check the link with whoever sent it; they can make a new one from Settings.'
              : `${preview.error.message}. Nothing has changed; try again.`}
          </p>
          <p className="mt-2 font-mono text-caption text-subtle">invite: {code}</p>
          {!isNotFound(preview.error) && (
            <Button size="sm" className="mt-4" onClick={() => void preview.refetch()}>
              Retry
            </Button>
          )}
        </Card>
      </Frame>
    );

  const p = preview.data;
  const memberOf = p.workspaceId
    ? me.data?.memberships.find((m) => m.workspaceId === p.workspaceId)
    : undefined;
  const acceptError =
    accept.error instanceof ApiRequestError && accept.error.status === 410
      ? 'This invite expired while you were signing in. Ask for a new link.'
      : accept.error?.message;

  return (
    <Frame>
      <Card className="p-8">
        <p className="text-label text-subtle">You're invited to join</p>
        <h1 className="mt-1 font-display text-display-sm text-strong">{p.workspaceName}</h1>

        {p.memberAvatars.length > 0 ? (
          <div className="mt-5 flex items-center gap-3">
            <ul className="flex -space-x-1.5" aria-label="Current members">
              {p.memberAvatars.map((m, i) => (
                <li key={m.login}>
                  <PersonAvatar
                    name={m.login}
                    avatarUrl={m.avatarUrl}
                    login={m.login}
                    colorIndex={i % 8}
                    className="size-8 border-2 border-surface text-label"
                  />
                </li>
              ))}
            </ul>
            <p className="text-label text-muted">
              {p.memberAvatars
                .slice(0, 3)
                .map((m) => `@${m.login}`)
                .join(', ')}
              {p.memberAvatars.length > 3 && ` and ${p.memberAvatars.length - 3} more`}
            </p>
          </div>
        ) : (
          <p className="mt-5 text-body text-muted">You'll be the first one here.</p>
        )}

        {memberOf ? (
          <div className="mt-6 space-y-3">
            <p role="status" className="text-body text-muted">
              You're already a member of {p.workspaceName}
              {me.data && (
                <>
                  {' '}
                  as <span className="text-default">@{me.data.user.githubLogin}</span>
                </>
              )}
              .
            </p>
            <Link to={`/w/${memberOf.workspaceId}/mc`} className={linkButton}>
              Open {p.workspaceName}
            </Link>
          </div>
        ) : p.expired ? (
          <div role="alert" className="mt-6 rounded-sm border border-warning px-3 py-2.5">
            <p className="text-body font-medium text-strong">This invite has expired</p>
            <p className="mt-0.5 text-label text-muted">
              It ran out of time or uses. Ask a teammate to share a new link from Settings.
            </p>
          </div>
        ) : me.isPending ? (
          <div
            className="mt-6 h-control-xl animate-pulse rounded-md bg-raised"
            aria-busy="true"
            aria-label="Checking sign-in"
          />
        ) : me.data ? (
          <div className="mt-6 space-y-3">
            <p className="text-label text-subtle">
              Joining as <span className="text-default">@{me.data.user.githubLogin}</span>
            </p>
            {/* acceptInvite is idempotent: an existing member just lands in the workspace. */}
            <Button
              variant="primary"
              size="xl"
              className="w-full"
              loading={accept.isPending}
              onClick={() => accept.mutate()}
            >
              Join {p.workspaceName}
            </Button>
            {acceptError && (
              <p role="alert" className="text-label text-danger">
                Couldn't join: {acceptError}
              </p>
            )}
          </div>
        ) : (
          <a
            href={`${API_PREFIX}/auth/github/login?next=${encodeURIComponent(`/j/${code}`)}`}
            className={cn(linkButton, 'mt-6')}
          >
            Continue with GitHub to join
          </a>
        )}

        <p className="mt-5 text-label text-subtle">
          We read your public repos to suggest skills. We never read private code without asking.
        </p>
      </Card>
    </Frame>
  );
}
