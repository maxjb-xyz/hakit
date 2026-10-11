/**
 * Event (hackathon template) picker shared by S2 workspace creation and the S14 Settings "Event" section:
 * the template card with its window and contents, or a custom event with its own dates. Plus the small date
 * helpers both screens need to round-trip `<input type="datetime-local">` values.
 */
import { useQuery } from '@tanstack/react-query';
import type { HackathonTemplate } from '@hakit/contracts';
import { cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { DEFAULT_HACKATHON_SLUG } from '../plan/ConstraintsStep';

export type EventKind = 'hackathon' | 'custom';

export const fmtDay = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  });

/** `<input type="datetime-local">` value (local time, minutes) → ISO with offset. */
export const fromLocal = (v: string) => (v ? new Date(v).toISOString() : undefined);

/** ISO timestamp → `<input type="datetime-local">` value in the browser's time zone. */
export function toLocal(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The browser's IANA zone plus its short name, e.g. "America/New_York (EDT)". */
export function localTimeZoneLabel(at = new Date()) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  return short && short !== zone ? `${zone} (${short})` : zone;
}

export function useHackathonTemplate(slug: string = DEFAULT_HACKATHON_SLUG) {
  return useQuery({
    queryKey: qk('getHackathon', { slug }),
    queryFn: () => api('getHackathon', { params: { slug } }),
  });
}

function TemplateOption(props: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-md border p-4 transition-colors duration-(--duration-instant)',
        props.disabled ? 'cursor-default' : 'cursor-pointer',
        'press has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-accent-400',
        props.checked
          ? 'border-accent-400 bg-accent-a12'
          : cn('border-border', !props.disabled && 'hover:border-border-strong hover:bg-raised'),
      )}
    >
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        className="mt-1 shrink-0 accent-accent-500"
      />
      <span className="min-w-0 space-y-1">
        <span className="block text-body font-medium text-strong">{props.title}</span>
        {props.children}
      </span>
    </label>
  );
}

function TemplateSummary({
  query,
}: {
  query: { data?: HackathonTemplate; isPending: boolean; isError: boolean };
}) {
  if (query.isPending) return <span className="block text-label text-subtle">Loading event details…</span>;
  if (query.isError || !query.data)
    return (
      <span className="block text-label text-warning">
        Couldn't load the template details. You can still pick it; the server fills them in.
      </span>
    );
  const t = query.data;
  return (
    <span className="block space-y-0.5 text-label text-muted">
      <span className="block">
        {fmtDay(t.startsAt, t.timezone)} → {fmtDay(t.endsAt, t.timezone)}
      </span>
      <span className="block text-subtle">
        {t.tracks.length} tracks · {t.challenges.length} sponsor challenges · judging criteria included
      </span>
    </span>
  );
}

/** Radio group: the hackathon template (with its window) or a custom event. */
export function EventPicker(props: {
  name: string;
  value: EventKind;
  onChange: (v: EventKind) => void;
  template: ReturnType<typeof useHackathonTemplate>;
  disabled?: boolean;
  customHint?: string;
}) {
  return (
    <fieldset className="space-y-2" disabled={props.disabled}>
      <legend className="mb-2 text-label text-subtle">Event</legend>
      <TemplateOption
        name={props.name}
        checked={props.value === 'hackathon'}
        disabled={props.disabled}
        onChange={() => props.onChange('hackathon')}
        title={props.template.data?.name ?? 'Knight Hacks IX'}
      >
        <TemplateSummary query={props.template} />
      </TemplateOption>
      <TemplateOption
        name={props.name}
        checked={props.value === 'custom'}
        disabled={props.disabled}
        onChange={() => props.onChange('custom')}
        title="Custom event"
      >
        <span className="block text-label text-muted">
          {props.customHint ??
            'Another hackathon or a side project. You set the deadline; add challenges later.'}
        </span>
      </TemplateOption>
    </fieldset>
  );
}
