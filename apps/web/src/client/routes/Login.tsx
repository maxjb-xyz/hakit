/**
 * S1 Sign-in (DESIGN §8, T-207). Product statement + Team → Plan → Ship, one "Continue with GitHub" action,
 * and the permission promise. OAuth failures come back as `/login?error=<code>` from the auth flow.
 * The GitHub link is a browser navigation (a redirect, not a JSON endpoint), so it isn't an `api()` call.
 */
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX } from '@hakit/contracts';
import { cn, Logo } from '@hakit/ui';
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
  'press inline-flex h-control-xl w-full items-center justify-center gap-2.5 rounded-md bg-strong px-5 text-body-lg font-medium text-on-light shadow-[inset_0_-1px_0_var(--color-level-4)] hover:bg-default active:bg-muted';

function GitHubMark() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4.5 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

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
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas p-6 max-sm:p-4">
      {/* Decorative: a faint dot grid fading out from the top, and one soft light behind the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--color-border-strong)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 h-96 w-full max-w-4xl -translate-x-1/2 [background:radial-gradient(ellipse_at_top,var(--color-sheen),transparent_70%)]"
      />
      <div className="relative grid w-full max-w-4xl items-center gap-12 md:grid-cols-2">
        <section>
          <p className="flex animate-fade-in items-center gap-2 font-display text-display-sm text-strong">
            <Logo className="size-7" />
            Hakit
          </p>
          <h1 className="mt-6 animate-slide-up font-display text-display-lg text-strong">
            The hackathon OS that knows your team and what to build next.
          </h1>
          <ol className="relative mt-10 space-y-5">
            <span
              aria-hidden
              className="absolute top-4 bottom-4 left-3.5 border-l border-dashed border-border-strong"
            />
            {STEPS.map((s, i) => (
              <li
                key={s.n}
                style={{ '--i': i + 2 } as React.CSSProperties}
                className="relative flex animate-list-in gap-3"
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border bg-canvas font-mono text-label',
                    i === 0 ? 'border-accent-400 text-strong' : 'border-border-strong text-muted',
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

        <Card className="animate-pop-in p-8 shadow-e2 max-sm:p-5">
          {error && (
            <div role="alert" className="mb-5 rounded-sm border border-danger px-3 py-2.5">
              <p className="text-body font-medium text-strong">{errorCopy(error).title}</p>
              <p className="mt-0.5 text-label text-muted">{errorCopy(error).body}</p>
              <p className="mt-1.5 font-mono text-caption text-subtle">code: {error}</p>
            </div>
          )}

          {me.isPending ? (
            <div
              className="skeleton h-control-xl rounded-md"
              aria-busy="true"
              aria-label="Checking sign-in"
            />
          ) : me.data ? (
            <>
              <div className="flex items-center gap-3">
                <PersonAvatar
                  name={me.data.user.name ?? me.data.user.githubLogin}
                  avatarUrl={me.data.user.avatarUrl}
                  login={me.data.user.githubLogin}
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
                <GitHubMark />
                {error ? 'Try again with GitHub' : 'Continue with GitHub'}
              </a>
            </>
          )}

          <p className="mt-5 flex gap-2 border-t border-border pt-4 text-label text-subtle">
            <span aria-hidden className="text-faint">
              ●
            </span>
            We read your public repos to suggest skills. We never read private code without asking.
          </p>
        </Card>
      </div>
    </main>
  );
}
