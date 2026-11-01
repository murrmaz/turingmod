import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A page's frame: its content, padded and filling the height the console gives it, with room at the
 * right edge for what's selected (`panel`, usually a `DetailPanel`). `className` is for the content,
 * e.g. a page that scrolls as a whole rather than within a table.
 */
export function PageLayout({
  panel,
  className,
  children,
}: {
  panel?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn('flex min-w-0 flex-1 flex-col gap-4 px-8 py-6', className)}>
        {children}
      </div>
      {panel}
    </div>
  );
}
