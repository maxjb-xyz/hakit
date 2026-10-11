/**
 * A number that "ticks" when it changes. Each character is keyed by position + value, so only the digits
 * that changed replay `animate-tick` (a short drop-in); everything else stays put. Reduced motion: static.
 * Screen readers read `label` (or the value) once from a visually hidden span, not the per-digit spans.
 */
import { cn } from '../cn';

export interface TickNumberProps {
  value: string | number;
  className?: string;
  /** Accessible text, e.g. "3 hours 12 minutes". Defaults to the value itself. */
  label?: string;
}

export function TickNumber({ value, className, label }: TickNumberProps) {
  const text = String(value);
  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{label ?? text}</span>
      {[...text].map((ch, i) => (
        <span key={`${i}-${ch}`} aria-hidden className={cn('inline-block', /\d/.test(ch) && 'animate-tick')}>
          {ch}
        </span>
      ))}
    </span>
  );
}
