import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A text box with a search icon, for filtering a table. `className` places and sizes it (e.g.
 * `ml-auto w-64`); every other prop, `ref` included, goes to the input.
 */
export function SearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} className="pl-8" />
    </div>
  );
}
