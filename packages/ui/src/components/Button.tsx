/**
 * Reference component — the pattern every primitive follows (T-102):
 * tokens-only classes, variant/size maps, forwards native props, visible focus, loading keeps width.
 */
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

const variants = {
  primary:
    'bg-accent-500 text-strong shadow-[inset_0_1px_0_var(--color-sheen)] hover:bg-accent-600 active:bg-accent-600',
  secondary:
    'bg-raised text-default border border-border-strong hover:bg-hover hover:text-strong hover:border-level-3 active:bg-pressed',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-strong active:bg-pressed',
  danger: 'bg-danger text-strong hover:opacity-90 active:opacity-80',
} as const;

const sizes = {
  sm: 'h-control-sm px-2 text-label rounded-xs',
  md: 'h-control-md px-3 text-body rounded-sm',
  lg: 'h-control-lg px-4 text-body rounded-sm',
  xl: 'h-control-xl px-5 text-body-lg rounded-md',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'press relative inline-flex cursor-pointer items-center justify-center gap-1.5 font-medium select-none disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      <span className={cn(loading && 'invisible')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <span className="size-3 animate-spin rounded-full border-(length:--border-width-emphasis) border-current border-t-transparent" />
        </span>
      )}
    </button>
  );
}
