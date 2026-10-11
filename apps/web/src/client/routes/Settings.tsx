/**
 * S14 Settings & integrations (DESIGN §8). The event (name, template, window) and projects, the S2 invite panel,
 * then integrations: GitHub (App + connected repo),
 * personal agent tokens (T-601: create shown once, list, revoke) and AI provider status (`aiStatus`).
 * Members, privacy and danger-zone sections need endpoints that don't exist yet.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentTokenCreated, AgentTokenSummary, AiProviderStatus } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { qk } from '../lib/query';
import { Panel, ago, useNow } from './mission-control/shared';
import { InvitePanel } from './people/InvitePanel';
import { CopyField, EmptyBox, ErrorBox, LoadingBlocks, PageHeader, Pill } from './page-states';
import { EventPanel, ProjectsPanel } from './workspace/EventSettings';

export function Settings() {
  const { wid = '' } = useParams();
  return (
    <div className="space-y-6 p-6 max-sm:p-4">
      <PageHeader title="Settings" subtitle="Event, team and integrations for this workspace" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <SectionNav />
        <div className="min-w-0 max-w-3xl space-y-10">
          <EventSection wid={wid} />
          <Section
            id="invites"
            title="Invites"
            description="Share a link so teammates can join this workspace."
          >
            <InvitePanel wid={wid} />
          </Section>
          <GithubSection wid={wid} />
          <AgentTokensSection wid={wid} />
          <AiSection />
        </div>
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: 'event', label: 'Event & projects' },
  { id: 'invites', label: 'Invites' },
  { id: 'github', label: 'GitHub' },
  { id: 'agent-tokens', label: 'Agent tokens' },
  { id: 'ai', label: 'AI status' },
] as const;

/** In-page section nav: anchors to each section; the one in view is marked current. */
function SectionNav() {
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setCurrent(hit.target.id);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return (
    <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto max-lg:-mx-1 max-lg:pb-1 lg:flex-col">
        {SECTIONS.map((s) => {
          const active = current === s.id;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={active ? 'location' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setCurrent(s.id);
                  const el = document.getElementById(s.id);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
                }}
                className={cn(
                  'interactive press relative flex h-control-md items-center rounded-sm px-3 text-body whitespace-nowrap',
                  active ? 'bg-raised text-strong' : 'text-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-strong transition-opacity duration-(--duration-fast) max-lg:hidden',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Section(props: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  const id = `${props.id}-h`;
  return (
    <section id={props.id} aria-labelledby={id} className="animate-fade-in scroll-mt-4 space-y-3">
      <div className="space-y-1 border-b border-border pb-3">
        <h2 id={id} tabIndex={-1} className="text-body-lg font-medium text-strong outline-none">
          {props.title}
        </h2>
        <p className="max-w-xl text-body text-muted">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

/* ----------------------------- Event ----------------------------- */

function EventSection({ wid }: { wid: string }) {
  return (
    <Section
      id="event"
      title="Event"
      description="The hackathon you're in and its window. The deadline drives the countdown, plan hours and the critical path."
    >
      <div className="space-y-4">
        <EventPanel wid={wid} />
        <ProjectsPanel wid={wid} />
      </div>
    </Section>
  );
}

/* ----------------------------- GitHub ----------------------------- */

function GithubSection({ wid }: { wid: string }) {
  // The project in view; the projects list already carries its repoId.
  const { project: current, query: project } = useProject(wid);
  const repos = useQuery({ queryKey: qk('listRepos'), queryFn: () => api('listRepos') });
  const install = useMutation({
    mutationFn: () => api('installUrl', { query: { workspaceId: wid } }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const repoId = current?.repoId ?? null;
  const repo = repos.data?.find((r) => r.id === repoId);

  return (
    <Section
      id="github"
      title="GitHub"
      description="The Hakit GitHub App sends commits, branches and PRs to the Code screen and Mission Control. It reads metadata, never code."
    >
      <Panel title="GitHub App">
        <div className="space-y-3 p-4">
          {project.isPending || repos.isPending ? (
            <LoadingBlocks label="Loading GitHub status" rows={1} />
          ) : project.isError || repos.isError ? (
            <ErrorBox
              what="GitHub status"
              error={(project.error ?? repos.error)!}
              onRetry={() => {
                void project.refetch();
                void repos.refetch();
              }}
            />
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-(--grid-lane-legend)">
              <dt className="text-muted">App access</dt>
              <dd>
                {repos.data.length > 0 ? (
                  <Pill tone="success">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    Installed · {repos.data.length} repo{repos.data.length === 1 ? '' : 's'} visible
                  </Pill>
                ) : (
                  <Pill tone="warning">Not installed on any repository</Pill>
                )}
              </dd>
              <dt className="text-muted">Project repository</dt>
              <dd className="min-w-0">
                {repo ? (
                  <a
                    href={repo.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-default hover:text-strong"
                  >
                    {repo.fullName}
                  </a>
                ) : repoId !== null ? (
                  <span className="text-warning">Connected repo is no longer visible to the App</span>
                ) : (
                  <span className="text-subtle">None connected</span>
                )}
              </dd>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <Button loading={install.isPending} onClick={() => install.mutate()}>
              Manage App access on GitHub
            </Button>
            <Link
              to={`/w/${wid}/code`}
              className="interactive press inline-flex h-control-md items-center rounded-sm px-3 text-body text-muted"
            >
              {repoId === null ? 'Connect a repository' : 'Open Code'}
            </Link>
          </div>
          {install.isError && (
            <p role="alert" className="text-label text-danger">
              Couldn't start the GitHub install ({install.error.message}).
            </p>
          )}
        </div>
      </Panel>
    </Section>
  );
}

/* ----------------------------- agent tokens ----------------------------- */

function AgentTokensSection({ wid }: { wid: string }) {
  const now = useNow();
  const qc = useQueryClient();
  const tokens = useQuery({
    queryKey: qk('listAgentTokens', { wid }),
    queryFn: () => api('listAgentTokens', { params: { wid } }),
  });
  const [created, setCreated] = useState<(AgentTokenCreated & { name: string }) | null>(null);

  return (
    <Section
      id="agent-tokens"
      title="Agent tokens"
      description="Personal tokens let the Hakit Claude Code plugin report session status (active, waiting, idle). Prompts are never shared unless you turn that on for a token."
    >
      <div className="space-y-4">
        <CreateTokenForm
          wid={wid}
          onCreated={(t) => {
            setCreated(t);
            void qc.invalidateQueries({ queryKey: qk('listAgentTokens', { wid }) });
          }}
        />
        {created && <ShownOnce token={created} onDismiss={() => setCreated(null)} />}
        <Panel
          title="Your tokens"
          meta={tokens.data ? `${tokens.data.filter((t) => !t.revokedAt).length} active` : undefined}
        >
          <div className="p-2">
            {tokens.isPending ? (
              <LoadingBlocks label="Loading agent tokens" rows={2} />
            ) : tokens.isError ? (
              <ErrorBox what="agent tokens" error={tokens.error} onRetry={() => void tokens.refetch()} />
            ) : tokens.data.length === 0 ? (
              <EmptyBox message="No agent tokens yet. Create one above to connect Claude Code." />
            ) : (
              <ul className="divide-y divide-border">
                {tokens.data.map((t) => (
                  <TokenRow key={t.id} token={t} wid={wid} now={now} />
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>
    </Section>
  );
}

function CreateTokenForm(props: {
  wid: string;
  onCreated: (t: AgentTokenCreated & { name: string }) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [sharePrompts, setSharePrompts] = useState(false);
  const [sharePaths, setSharePaths] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      api('createAgentToken', {
        params: { wid: props.wid },
        body: { name: name.trim(), sharePrompts, sharePaths },
      }),
    onSuccess: (t) => {
      props.onCreated({ ...t, name: name.trim() });
      setName('');
    },
  });
  const valid = name.trim().length > 0 && name.trim().length <= 60;
  return (
    <Panel title="New token">
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className="text-label text-muted">
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Laptop · Claude Code"
            className="field h-control-md w-full max-w-md rounded-sm px-3 text-body placeholder:text-disabled"
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-label text-muted">Sharing</legend>
          <label className="flex items-center gap-2 text-body text-default">
            <input
              type="checkbox"
              checked={sharePaths}
              onChange={(e) => setSharePaths(e.target.checked)}
              className="accent-accent-500"
            />
            Share repo, branch and folder names
          </label>
          <label className="flex items-center gap-2 text-body text-default">
            <input
              type="checkbox"
              checked={sharePrompts}
              onChange={(e) => setSharePrompts(e.target.checked)}
              className="accent-accent-500"
            />
            Share prompts{' '}
            <span className="text-label text-subtle">(off by default; teammates can read them)</span>
          </label>
        </fieldset>
        <Button type="submit" variant="primary" disabled={!valid} loading={create.isPending}>
          Create token
        </Button>
        {create.isError && (
          <p role="alert" className="text-label text-danger">
            Couldn't create the token ({create.error.message}). Nothing was saved.
          </p>
        )}
      </form>
    </Panel>
  );
}

function ShownOnce(props: { token: AgentTokenCreated & { name: string }; onDismiss: () => void }) {
  return (
    <div role="status" className="animate-slide-up space-y-3 rounded-md border border-warning bg-surface p-4">
      <p className="text-body text-default">
        <span className="font-medium text-warning">Copy this token now.</span> “{props.token.name}” won't be
        shown again. Hakit stores only a hash of it.
      </p>
      <CopyField label="Token" value={props.token.token} />
      <CopyField label="Install command" value={props.token.installCommand} />
      <Button size="sm" variant="ghost" onClick={props.onDismiss}>
        I've copied it
      </Button>
    </div>
  );
}

function TokenRow(props: { token: AgentTokenSummary; wid: string; now: number }) {
  const t = props.token;
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api('revokeAgentToken', { params: { id: t.id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk('listAgentTokens', { wid: props.wid }) }),
  });
  const revoked = t.revokedAt !== null;
  return (
    <li className="flex animate-fade-in flex-wrap items-center gap-x-4 gap-y-2 rounded-sm px-2 py-3 transition-colors duration-(--duration-instant) hover:bg-hover">
      <div className="min-w-0 flex-1">
        {/* Revoked rows are struck through and dimmed by token, not opacity (keeps meta text at AA contrast). */}
        <p className={cn('truncate text-body', revoked ? 'text-subtle line-through' : 'text-default')}>
          {t.name}
        </p>
        <p className="text-label text-subtle">
          Created {ago(t.createdAt, props.now)} · last used{' '}
          {t.lastUsedAt ? ago(t.lastUsedAt, props.now) : 'never'}
          {' · '}
          {t.sharePrompts ? 'shares prompts' : 'no prompts'}
          {' · '}
          {t.sharePaths ? 'shares paths' : 'no paths'}
        </p>
      </div>
      {revoked ? (
        <Pill>Revoked {ago(t.revokedAt, props.now)}</Pill>
      ) : confirming ? (
        <span className="flex animate-pop-in items-center gap-2">
          <span className="text-label text-muted">Agents using it stop reporting.</span>
          <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Revoke
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <>
          <Pill tone="success">Active</Pill>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Revoke…
          </Button>
        </>
      )}
      {revoke.isError && (
        <p role="alert" className="w-full text-label text-danger">
          Couldn't revoke ({revoke.error.message}). The token is still active.
        </p>
      )}
    </li>
  );
}

/* ----------------------------- AI providers ----------------------------- */

const ROLE_LABEL: Record<AiProviderStatus['role'], string> = {
  plan: 'Planning',
  fast: 'Fast (explanations, linking)',
  embeddings: 'Embeddings',
};
const PROVIDER_LABEL: Record<AiProviderStatus['provider'], string> = {
  gemini: 'Gemini',
  hf: 'Hugging Face',
  amd: 'AMD',
  workers_ai: 'Workers AI',
  template: 'Template (no AI)',
  keyword: 'Keyword match (no AI)',
};

function AiSection() {
  const now = useNow();
  const status = useQuery({
    queryKey: qk('aiStatus'),
    queryFn: () => api('aiStatus'),
    refetchInterval: 60_000,
  });
  return (
    <Section
      id="ai"
      title="AI providers"
      description="AI drafts ideas, plans and explanations. Scores, hours and assignments are always computed by Hakit's engine. When a provider is down, Hakit falls back to templates."
    >
      <Panel
        title="Status"
        meta={
          status.dataUpdatedAt
            ? `checked ${ago(new Date(status.dataUpdatedAt).toISOString(), now)}`
            : undefined
        }
      >
        <div className="p-2">
          {status.isPending ? (
            <LoadingBlocks label="Loading AI provider status" rows={2} />
          ) : status.isError ? (
            <ErrorBox what="AI provider status" error={status.error} onRetry={() => void status.refetch()} />
          ) : status.data.length === 0 ? (
            <EmptyBox message="No AI providers are configured. Planning uses templates and manual tasks." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <caption className="sr-only">AI provider status by role</caption>
                <thead>
                  <tr className="border-b border-border">
                    {['Role', 'Provider', 'Model', 'Status'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-2 py-2 text-left text-caption font-medium uppercase tracking-wide text-subtle"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {status.data.map((p) => (
                    <tr key={`${p.role}-${p.provider}-${p.model}`}>
                      <td className="px-2 py-2.5 text-default">{ROLE_LABEL[p.role]}</td>
                      <td className="px-2 py-2.5 text-muted">{PROVIDER_LABEL[p.provider]}</td>
                      <td className="px-2 py-2.5 font-mono text-label text-muted">{p.model}</td>
                      <td className="px-2 py-2.5">
                        {p.healthy ? (
                          <Pill tone="success">
                            <span aria-hidden className="size-1.5 rounded-full bg-success" />
                            Healthy
                          </Pill>
                        ) : (
                          <Pill tone="warning" title={p.lastErrorAt ?? undefined}>
                            Unavailable{p.lastErrorAt && ` · last error ${ago(p.lastErrorAt, now)}`}
                          </Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </Section>
  );
}
