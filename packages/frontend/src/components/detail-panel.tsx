import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The panel at a page's right edge showing everything about what's selected, with a way to close
 * it: an integration on the Integrations page, a row on the Data page.
 */
export function DetailPanel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: ReactNode;
  /** Under the title, e.g. a status. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-l p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate font-mono text-base font-semibold">{title}</h3>
          {subtitle}
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      {children}
    </aside>
  );
}
