import type { Column } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A header that sorts its column when clicked, with an arrow for the current direction. */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}) {
  if (!column.getCanSort()) {
    return <span className={className}>{title}</span>;
  }
  const sorted = column.getIsSorted();
  const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        '-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground',
        sorted && 'text-foreground',
        className
      )}
    >
      {title}
      <Icon className={cn('size-3.5', !sorted && 'opacity-50')} />
    </button>
  );
}
