import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

/** A keycap: `<Kbd>⌘K</Kbd>`. Pair it with words, or aria-keyshortcuts on the control it describes. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      {...rest}
      className={cn(
        'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-xs border border-border-strong bg-surface px-1 font-sans text-caption text-subtle shadow-[inset_0_-1px_0_var(--color-border)]',
        className,
      )}
    />
  );
}
