/**
 * S1 Sign-in (DESIGN §8, T-207). Product statement + Team → Plan → Ship, one "Continue with GitHub" action,
 * and the permission promise. OAuth failures come back as `/login?error=<code>` from the auth flow.
 * The GitHub link is a browser navigation (a redirect, not a JSON endpoint), so it isn't an `api()` call.
 */
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { Card, PersonAvatar } from './people/shared';

/** Keeps `next` same-origin, mirroring the server's `safeNext`. */
const safeNext = (next: string | null) =>
  next && /^\/(?![/\\])/.test(next) && !/[\r\n]/.test(next) ? next : '/';

const ERRORS: Record<string, { title: string; body: string }> = {
  access_denied: {
    title: 'GitHub sign-in was cancelled',
    body: "Hakit didn't get permission, so nothing was read or saved. Try again when you're ready.",
  },
  invalid_state: {
    title: 'That sign-in link expired',
    body: 'Sign-in links last 10 minutes and work once. Start again below.',
  },
  rate_limited: {
    title: 'GitHub is rate-limiting us',
    body: 'Wait a minute and try again; repeated tries make the wait longer.',
  },
};
const errorCopy = (code: string) =>
  ERRORS[code] ?? {
    title: "Couldn't sign you in",
    body: 'GitHub returned an error. Nothing was saved; try again.',
  };

const STEPS = [
  { n: '1', title: 'Team', body: 'Skills read from public GitHub work, confirmed by you.' },
  { n: '2', title: 'Plan', body: 'A plan sized to your hours, with every assignment explained.' },
  { n: '3', title: 'Ship', body: 'Live progress from commits and agents, re-planned when things slip.' },
];

const linkButton =
  'inline-flex h-control-xl w-full items-center justify-center rounded-md bg-accent-500 px-5 text-body-lg font-medium text-strong transition-colors duration-(--duration-instant) hover:bg-accent-400 active:bg-accent-600';

export function Login() {
  const [search] = useSearchParams();
  const next = safeNext(search.get('next'));
  const error = search.get('error');
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  const loginHref = `${API_PREFIX}/auth/github/login?next=${encodeURIComponent(next)}`;
  const firstWorkspace = me.data?.memberships[0];
  const continueTo =
    next !== '/' ? next : firstWorkspace ? `/w/${firstWorkspace.workspaceId}/mc` : '/onboarding';

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6 max-sm:p-4">
      <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-2">
        <section>
          <p className="font-display text-display-sm text-strong">hakit</p>
          <h1 className="mt-4 font-display text-display-lg text-strong">
            The hackathon OS that knows your team and what to build next.
          </h1>
          <ol className="mt-8 space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.n} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border font-mono text-label',
                    i === 0 ? 'border-accent-500 text-strong' : 'border-border-strong text-muted',
                  )}
                >
                  {s.n}
                </span>
                <div>
                  <p className="text-body font-medium text-strong">{s.title}</p>
                  <p className="text-body text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <Card className="p-8">
          {error && (
            <div role="alert" className="mb-5 rounded-sm border border-danger px-3 py-2.5">
              <p className="text-body font-medium text-strong">{errorCopy(error).title}</p>
              <p className="mt-0.5 text-label text-muted">{errorCopy(error).body}</p>
              <p className="mt-1.5 font-mono text-caption text-subtle">code: {error}</p>
            </div>
          )}

          {me.isPending ? (
            <div
              className="h-control-xl animate-pulse rounded-md bg-raised"
              aria-busy="true"
              aria-label="Checking sign-in"
            />
          ) : me.data ? (
            <>
              <div className="flex items-center gap-3">
                <PersonAvatar
                  name={me.data.user.name ?? me.data.user.githubLogin}
                  avatarUrl={me.data.user.avatarUrl}
                  className="size-9 text-label"
                  decorative
                />
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-strong">
                    Signed in as {me.data.user.name ?? me.data.user.githubLogin}
                  </p>
                  <p className="truncate font-mono text-label text-subtle">@{me.data.user.githubLogin}</p>
                </div>
              </div>
              <Link to={continueTo} className={cn(linkButton, 'mt-6')}>
                Continue{firstWorkspace && next === '/' ? ` to ${firstWorkspace.workspaceName}` : ''}
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-title font-medium text-strong">Sign in</h2>
              <p className="mt-1 text-body text-muted">
                One click. Your GitHub account is your Hakit account.
              </p>
              <a href={loginHref} className={cn(linkButton, 'mt-6')}>
                {error ? 'Try again with GitHub' : 'Continue with GitHub'}
              </a>
            </>
          )}

          <p className="mt-5 text-label text-subtle">
            We read your public repos to suggest skills. We never read private code without asking.
          </p>
        </Card>
      </div>
    </main>
  );
}
