import type { CellContext, ColumnDef, RowData } from '@tanstack/react-table';
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ConsoleFeatures } from '@/lib/tableFeatures';

/** The narrow column at a table's right edge holding what can be done with a row. */
export function actionsColumn<Row extends RowData>(
  cell: (context: CellContext<ConsoleFeatures, Row, unknown>) => ReactNode
): ColumnDef<ConsoleFeatures, Row> {
  return {
    id: 'actions',
    size: 52,
    enableSorting: false,
    enableHiding: false,
    meta: { cellClassName: 'overflow-visible px-2 text-right' },
    cell,
  };
}

/**
 * A row's "…" menu, whose items are `children`. Using it doesn't count as clicking the row, which
 * usually does something of its own.
 */
export function RowActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
