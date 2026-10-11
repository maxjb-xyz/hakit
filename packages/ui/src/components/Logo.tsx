import { cn } from '../cn';

/** Hakit mark: a bold "H" on a light rounded tile. Same mark as the favicon and submission thumbnail. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-sm bg-strong font-display text-label font-extrabold text-on-light',
        className,
      )}
    >
      H
    </span>
  );
}
