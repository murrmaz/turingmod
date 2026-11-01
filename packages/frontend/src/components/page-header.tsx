import type { ReactNode } from 'react';

/** The top of a page: its title and, below it, what the page is for. */
export function PageHeader({ title, description }: { title: string; description: ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
