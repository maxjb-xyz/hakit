import { useEffect, useState } from 'react';
import { cn } from '@hakit/ui';

/** Top-bar countdown (DESIGN §7). Warning < 6h, danger < 2h. Replace/extend in T-103. */
export function Countdown({ deadlineAt, size = 'sm' }: { deadlineAt: string; size?: 'sm' | 'lg' }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(deadlineAt).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        size === 'lg' ? 'text-display-lg font-semibold' : 'text-label',
        h < 2 ? 'text-danger' : h < 6 ? 'text-warning' : size === 'lg' ? 'text-strong' : 'text-muted',
      )}
      aria-label={`${h} hours ${m} minutes remaining`}
    >
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
