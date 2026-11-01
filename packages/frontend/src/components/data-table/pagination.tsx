import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Page controls under a table. Takes plain numbers rather than a table instance, since the pages
 * may be the server's.
 */
export function DataTablePagination({
  page,
  pageCount,
  onPageChange,
  pageSize,
  pageSizes,
  onPageSizeChange,
  summary,
}: {
  /** Zero-based */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  pageSizes?: number[];
  onPageSizeChange?: (size: number) => void;
  /** Left-hand text, e.g. "13 of 33 commands" */
  summary?: ReactNode;
}) {
  const pages = Math.max(1, pageCount);
  return (
    <div className="flex items-center gap-4 px-1 py-3 text-sm text-muted-foreground">
      <div className="flex-1">{summary}</div>
      {pageSize !== undefined && pageSizes && onPageSizeChange && (
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger size="sm" className="w-20" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <span className="text-foreground">
        Page {Math.min(page + 1, pages)} of {pages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 0}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page + 1 >= pages}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
