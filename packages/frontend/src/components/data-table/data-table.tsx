import { flexRender, type Row, type Table as TanStackTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, type Ref, useEffect, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    /** Take the width left over by fixed-size columns, instead of `size`. */
    grow?: boolean;
    /** Classes for this column's cells (not its header). */
    cellClassName?: string;
    headerClassName?: string;
  }
}

export interface DataTableProps<TData> {
  table: TanStackTable<TData>;
  onRowClick?: (row: TData) => void;
  selectedRowId?: string | null;
  rowClassName?: (row: TData) => string | undefined;
  /** Render only the rows in view: for long, live lists. */
  virtualize?: boolean;
  rowHeight?: number;
  loading?: boolean;
  empty: ReactNode;
  /** The scrolling element, for callers that follow or restore its position. */
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: (element: HTMLDivElement) => void;
  className?: string;
}

/**
 * The console's one table: a TanStack table rendered with shadcn's table styles, with a sticky
 * header, fixed column widths (`size`, or `meta.grow` for the column that takes the rest) and,
 * for live feeds, row virtualization. Sorting, filtering and paging stay with the caller's table
 * instance, so the same component serves client-side and server-side data.
 */
export function DataTable<TData>({
  table,
  onRowClick,
  selectedRowId,
  rowClassName,
  virtualize = false,
  rowHeight = 41,
  loading = false,
  empty,
  scrollRef,
  onScroll,
  className,
}: DataTableProps<TData>) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const rows = table.getRowModel().rows;
  const columns = table.getVisibleLeafColumns();

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => ownRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  // Keep the selected row in view, e.g. while a sheet steps through rows with the arrow keys.
  const selectedIndex = selectedRowId ? rows.findIndex((row) => row.id === selectedRowId) : -1;
  useEffect(() => {
    if (selectedIndex < 0) {
      return;
    }
    if (virtualize) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    } else {
      ownRef.current
        ?.querySelector('tr[data-state="selected"]')
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, virtualize, virtualizer]);

  const items = virtualize ? virtualizer.getVirtualItems() : [];
  const rendered: Row<TData>[] = virtualize
    ? items.flatMap((item) => rows[item.index] ?? [])
    : rows;
  const paddingTop = virtualize ? (items[0]?.start ?? 0) : 0;
  const paddingBottom = virtualize
    ? virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0)
    : 0;

  const setRef = (element: HTMLDivElement | null) => {
    ownRef.current = element;
    if (typeof scrollRef === 'function') {
      scrollRef(element);
    } else if (scrollRef) {
      scrollRef.current = element;
    }
  };

  return (
    <div
      ref={setRef}
      onScroll={(event) => onScroll?.(event.currentTarget)}
      className={cn('relative min-h-0 flex-1 overflow-auto', className)}
    >
      <table className="w-full table-fixed caption-bottom text-sm">
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.id}
              style={column.columnDef.meta?.grow ? undefined : { width: column.getSize() }}
            />
          ))}
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    'h-10 px-3 text-xs font-medium text-muted-foreground',
                    header.column.columnDef.meta?.headerClassName
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading && rows.length === 0 ? (
            Array.from({ length: 8 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <TableRow key={index} className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableCell key={column.id} className="px-3" style={{ height: rowHeight }}>
                    <Skeleton className="h-4 w-3/4" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="h-32 text-center text-sm text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {paddingTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={columns.length} style={{ height: paddingTop }} />
                </tr>
              )}
              {rendered.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.id === selectedRowId ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                  style={{ height: rowHeight }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'truncate px-3 py-0',
                        cell.column.columnDef.meta?.cellClassName
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {paddingBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={columns.length} style={{ height: paddingBottom }} />
                </tr>
              )}
            </>
          )}
        </TableBody>
      </table>
    </div>
  );
}
