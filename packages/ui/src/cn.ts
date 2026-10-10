import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge must know our custom type scale (tokens.css `--text-*`); otherwise it reads
 * `text-label` as a colour and drops it next to `text-muted` (or vice versa).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'label', 'body', 'body-lg', 'title', 'display-sm', 'display-lg', 'hero'] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
