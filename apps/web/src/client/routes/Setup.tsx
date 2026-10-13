/**
 * First-run setup `/setup` for self-hosted instances. Checks the two secrets, then creates this instance's
 * GitHub App through GitHub's manifest flow: `startGithubSetup` returns the manifest, and the browser POSTs it
 * to github.com as a form (GitHub requires a top-level form post), which redirects back to the worker's
 * callback and then here with `?done=1` or `?error=<code>`. Sign-in sends a fresh instance here.
 */
import { useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Logo } from '@hakit/ui';
import { api, ApiRequestError } from '../lib/api';
import { qk } from '../lib/query';
import { ErrorBox, LoadingBlocks } from './page-states';
import { Card } from './people/shared';

const input = 'field mt-1 h-control-md w-full rounded-sm px-3 text-body text-strong placeholder:text-subtle';

const ERRORS: Record<string, string> = {
  invalid_state: 'That setup link expired or was opened in another browser. Start again below.',
  expired_code:
    'GitHub took longer than an hour to come back, so the new App could not be claimed. Start again.',
  already_configured: 'A GitHub App was already set up for this instance.',
};

/** POST the manifest to GitHub as a real form: the manifest flow can't be started with fetch. */
function submitManifest(action: string, manifest: string) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'manifest';
  field.value = manifest;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas px-6 py-10 max-sm:px-4 max-sm:py-6">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <p className="flex items-center gap-2 font-display text-title text-strong">
          <Logo />
          Hakit
        </p>
        {children}
      </div>
    </main>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-body">
      <span aria-hidden className={ok ? 'text-success' : 'text-danger'}>
        {ok ? '✓' : '✕'}
      </span>
      <span className="text-strong">{label}</span>
      <span className="text-label text-subtle">{ok ? 'set' : 'missing'}</span>
    </li>
  );
}

function GithubForm() {
  const id = useId();
  const [setupKey, setSetupKey] = useState('');
  const [organization, setOrganization] = useState('');
  const start = useMutation({
    mutationFn: () =>
      api('startGithubSetup', {
        body: { setupKey, organization: organization.trim() || undefined },
      }),
    onSuccess: (r) => submitManifest(r.action, r.manifest),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (setupKey) start.mutate();
  };
  const failure =
    start.error instanceof ApiRequestError
      ? start.error.body.message
      : start.error && 'Something went wrong.';

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <label htmlFor={`${id}-key`} className="text-label text-subtle">
          Setup key
        </label>
        <input
          id={`${id}-key`}
          type="password"
          className={input}
          autoComplete="off"
          value={setupKey}
          aria-describedby={`${id}-key-hint`}
          onChange={(e) => setSetupKey(e.target.value)}
        />
        <p id={`${id}-key-hint`} className="mt-1 text-label text-subtle">
          The SESSION_SECRET you set when deploying. It proves this is your instance.
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-org`} className="text-label text-subtle">
          GitHub organization (optional)
        </label>
        <input
          id={`${id}-org`}
          className={input}
          autoComplete="off"
          maxLength={39}
          value={organization}
          placeholder="Leave empty for your own account"
          onChange={(e) => setOrganization(e.target.value)}
        />
      </div>
      {failure && (
        <p role="alert" className="text-label text-danger">
          {failure}
        </p>
      )}
      <Button type="submit" disabled={!setupKey || start.isPending}>
        {start.isPending ? 'Opening GitHub…' : 'Create GitHub App'}
      </Button>
    </form>
  );
}

export function Setup() {
  const [search] = useSearchParams();
  const error = search.get('error');
  const done = search.get('done') === '1';
  const status = useQuery({ queryKey: qk('setupStatus'), queryFn: () => api('setupStatus') });

  return (
    <Frame>
      <div>
        <h1 className="font-display text-display-sm text-strong">Set up this instance</h1>
        <p className="mt-1 text-body text-muted">
          Hakit signs people in with GitHub and reads their activity through a GitHub App. This creates one
          for this instance in a couple of clicks.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-sm border border-danger px-3 py-2.5">
          <p className="text-body text-strong">
            {ERRORS[error] ?? 'GitHub setup did not finish. Try again.'}
          </p>
          <p className="mt-1 font-mono text-caption text-subtle">code: {error}</p>
        </div>
      )}

      {status.isPending ? (
        <LoadingBlocks label="Checking setup" rows={2} />
      ) : status.error ? (
        <ErrorBox what="setup status" error={status.error} onRetry={() => void status.refetch()} />
      ) : status.data.github !== 'missing' ? (
        <Card className="space-y-4">
          <p className="text-body text-strong">
            {done ? 'Your GitHub App is ready.' : 'GitHub is set up for this instance.'}
            {status.data.githubAppSlug && (
              <>
                {' '}
                It's{' '}
                <a
                  className="underline"
                  href={`https://github.com/apps/${status.data.githubAppSlug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {status.data.githubAppSlug}
                </a>
                .
              </>
            )}
          </p>
          <p className="text-label text-muted">
            Sign in with GitHub to create your team. You'll install the App on your repos from the workspace.
          </p>
          <Link
            to="/login"
            className="press inline-flex h-control-md items-center rounded-sm bg-strong px-4 text-body font-medium text-on-light"
          >
            Continue to sign in
          </Link>
        </Card>
      ) : !status.data.secrets.sessionSecret || !status.data.secrets.tokenEncKey ? (
        <Card className="space-y-3">
          <p className="text-body text-strong">Two secrets are needed first.</p>
          <ul className="space-y-1">
            <Check ok={status.data.secrets.sessionSecret} label="SESSION_SECRET" />
            <Check ok={status.data.secrets.tokenEncKey} label="TOKEN_ENC_KEY" />
          </ul>
          <p className="text-label text-muted">
            Each is any random string of 32 or more characters (for example from{' '}
            <code className="font-mono">openssl rand -base64 32</code>). Add them in the Cloudflare dashboard
            under the Worker's Settings, Variables and Secrets, or with{' '}
            <code className="font-mono">npx wrangler secret put NAME</code>, then reload this page.
          </p>
        </Card>
      ) : (
        <Card>
          <GithubForm />
        </Card>
      )}
    </Frame>
  );
}
