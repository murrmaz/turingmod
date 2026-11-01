import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Tailwind's merge knows only the default theme, so it's told the sizes `index.css` adds. Without
 * this it takes `text-data` for a colour, and `text-data text-muted-foreground` loses one of them.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['caption', 'data', 'body'], container: ['sheet'] } },
});

/** Join class names, letting later Tailwind utilities override earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
