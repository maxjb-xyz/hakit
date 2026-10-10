/**
 * S2 invite panel (DESIGN §8, T-207): create an invite link (`createInvite`, expiry + max uses per the contract),
 * copy it, and see who is already on the team. Used on Team (`?invite=1`), Settings and right after creating a
 * workspace. There is no list-invites endpoint, so a link is shown only in the session that made it; making a new
 * one never revokes the old ones.
 */
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Invite } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { CopyField, ErrorBox } from '../page-states';
import { PersonAvatar } from './shared';

const EXPIRY = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 24 * 7, label: '1 week' },
  { hours: 24 * 14, label: '2 weeks' },
] as const;

const field =
  'mt-1 h-control-md w-full rounded-sm border border-border-strong bg-sunken px-3 text-body text-strong placeholder:text-subtle';

const fmtExpiry = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function InvitePanel(props: { wid: string; className?: string; headingLevel?: 'h2' | 'h3' }) {
  const id = useId();
  const H = props.headingLevel ?? 'h2';
  const [expiresInHours, setExpiry] = useState<number>(72);
  const [limit, setLimit] = useState<'none' | 'limited'>('none');
  const [maxUses, setMaxUses] = useState('4');
  const [invite, setInvite] = useState<Invite | null>(null);
  const members = useQuery({
    queryKey: qk('listMembers', { wid: props.wid }),
    queryFn: () => api('listMembers', { params: { wid: props.wid } }),
  });
  const create = useMutation({
    mutationFn: () =>
      api('createInvite', {
        params: { wid: props.wid },
        body: { expiresInHours, maxUses: limit === 'none' ? null : Number(maxUses) },
      }),
    onSuccess: setInvite,
  });
  const usesValid = limit === 'none' || (/^\d+$/.test(maxUses) && +maxUses >= 1 && +maxUses <= 50);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (usesValid) create.mutate();
  };

  return (
    <section
      aria-labelledby={`${id}-h`}
      className={cn('space-y-4 rounded-md border border-border bg-surface p-5 max-sm:p-4', props.className)}
    >
      <div className="space-y-1">
        <H id={`${id}-h`} className="text-body-lg font-medium text-strong">
          Invite teammates
        </H>
        <p className="text-body text-muted">
          Hakit works best with your whole team. Share this link; whoever opens it signs in with GitHub and
          joins.
        </p>
      </div>

      {invite ? (
        <div className="space-y-3" role="status">
          <CopyField label="Invite link" value={invite.url} />
          <p className="text-label text-subtle">
            Expires {fmtExpiry(invite.expiresAt)} ·{' '}
            {invite.maxUses == null
              ? `${invite.uses} joined, no limit`
              : `${invite.uses} of ${invite.maxUses} uses`}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setInvite(null)}>
            Make another link
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-exp`} className="text-label text-subtle">
                Link expires after
              </label>
              <select
                id={`${id}-exp`}
                className={field}
                value={expiresInHours}
                onChange={(e) => setExpiry(Number(e.target.value))}
              >
                {EXPIRY.map((o) => (
                  <option key={o.hours} value={o.hours}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className="text-label text-subtle">How many people can use it</legend>
              <div className="mt-1 flex h-control-md items-center gap-4">
                <label className="flex items-center gap-2 text-body text-default">
                  <input
                    type="radio"
                    name={`${id}-limit`}
                    checked={limit === 'none'}
                    onChange={() => setLimit('none')}
                    className="accent-accent-500"
                  />
                  Anyone
                </label>
                <label className="flex items-center gap-2 text-body text-default">
                  <input
                    type="radio"
                    name={`${id}-limit`}
                    checked={limit === 'limited'}
                    onChange={() => setLimit('limited')}
                    className="accent-accent-500"
                  />
                  Up to
                </label>
                <label htmlFor={`${id}-max`} className="sr-only">
                  Maximum uses
                </label>
                <input
                  id={`${id}-max`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  disabled={limit === 'none'}
                  aria-invalid={!usesValid || undefined}
                  aria-describedby={!usesValid ? `${id}-max-err` : undefined}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  className="h-control-md w-16 rounded-sm border border-border-strong bg-sunken px-2 text-body text-strong disabled:opacity-50"
                />
              </div>
              {!usesValid && (
                <p id={`${id}-max-err`} className="mt-1 text-label text-danger">
                  Enter a number from 1 to 50.
                </p>
              )}
            </fieldset>
          </div>
          {create.isError && (
            <p role="alert" className="text-label text-danger">
              Couldn't create the link: {create.error.message}. Try again.
            </p>
          )}
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!usesValid}>
            Create invite link
          </Button>
        </form>
      )}

      <div className="border-t border-border pt-4">
        {members.isError ? (
          <ErrorBox what="the team" error={members.error} onRetry={() => void members.refetch()} />
        ) : members.isPending ? (
          <p className="text-label text-subtle">Loading the team…</p>
        ) : (
          <>
            <p className="text-label text-subtle">
              {members.data.length === 1 ? 'Only you so far.' : `${members.data.length} people on the team.`}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Team members">
              {members.data.map((m) => (
                <li
                  key={m.user.id}
                  className="flex h-control-sm items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5"
                >
                  <PersonAvatar
                    name={m.user.name ?? m.user.githubLogin}
                    avatarUrl={m.user.avatarUrl}
                    colorIndex={m.colorIndex}
                    className="size-5 text-caption"
                    decorative
                  />
                  <span className="text-label text-default">{m.user.name ?? m.user.githubLogin}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
