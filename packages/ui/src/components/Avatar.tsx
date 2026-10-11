/**
 * Member avatar: the GitHub picture (avatarUrl, else github.com/<login>.png), falling back to initials on the
 * member hue when there is no picture or it fails to load. A hairline ring keeps pictures and initials
 * consistent on near-black surfaces. Pass `decorative` when the name is already written next to it, so screen
 * readers don't hear it twice.
 */
import { useState } from 'react';
import { cn } from '../cn';

const sizes = {
  xs: { box: 'size-4 text-caption', px: 32 },
  sm: { box: 'size-5 text-caption', px: 40 },
  md: { box: 'size-6 text-caption', px: 48 },
  lg: { box: 'size-8 text-label', px: 64 },
  xl: { box: 'size-12 text-body', px: 96 },
} as const;

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

/** Picture URL for a member: the stored avatar, else GitHub's public avatar for the login. */
export function avatarSrc(avatarUrl: string | null | undefined, login: string | null | undefined, px = 64) {
  if (avatarUrl) return avatarUrl;
  return login ? `https://github.com/${encodeURIComponent(login)}.png?size=${px}` : null;
}

export interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  login?: string | null;
  /** membership.colorIndex (0–7) for the initials fallback. */
  colorIndex?: number;
  size?: keyof typeof sizes;
  decorative?: boolean;
  title?: string;
  className?: string;
}

export function Avatar({
  name,
  avatarUrl,
  login,
  colorIndex,
  size = 'md',
  decorative,
  title,
  className,
}: AvatarProps) {
  const s = sizes[size];
  const src = avatarSrc(avatarUrl, login, s.px);
  const [failed, setFailed] = useState<string | null>(null);
  const label = decorative ? undefined : name;
  const base = cn(
    'relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold ring-1 ring-border-strong',
    s.box,
    className,
  );
  if (src && failed !== src)
    return (
      <img
        src={src}
        alt={label ?? ''}
        title={title}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(src)}
        className={cn(base, 'bg-raised object-cover')}
      />
    );
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={title}
      className={cn(base, 'text-on-light', colorIndex === undefined && 'bg-level-5')}
      style={colorIndex === undefined ? undefined : { background: `var(--color-member-${colorIndex})` }}
    >
      {initialsOf(name)}
    </span>
  );
}
