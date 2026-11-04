import { Search } from 'lucide-react';
import { type ComponentProps, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { useFocusShortcut } from '@/hooks/useFocusShortcut';
import { cn } from '@/lib/utils';

/**
 * A text box with a search icon, for filtering a table; "/" focuses it, so a page has one.
 * `className` places and sizes it (e.g. `ml-auto w-64`); every other prop goes to the input.
 */
export function SearchInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'ref'>) {
  const input = useRef<HTMLInputElement | null>(null);
  useFocusShortcut(input);
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} ref={input} className="pl-8" />
    </div>
  );
}
