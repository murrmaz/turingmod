import type { ColumnDef } from '@tanstack/react-table';
import type { DataCell, DataColumnInfo, DataTableInfo } from '@turingmod/shared';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DotBadge } from '@/components/status';
import type { InspectedRow } from '@/hooks/useInspectedTable';
import { formatDateTime } from '@/lib/time';
import { activityEventTone } from '@/lib/tone';

/**
 * One column per table column, sized by kind: a JSON column takes the width left over. A masked
 * column can't be sorted, since its values never leave the backend.
 */
export function inspectorColumns(info: DataTableInfo): ColumnDef<InspectedRow>[] {
  return info.columns.map((column) => ({
    id: column.name,
    accessorFn: (row) => row.cells[column.name],
    header: ({ column: tableColumn }) => (
      <DataTableColumnHeader
        column={tableColumn}
        title={column.name}
        className="font-mono normal-case"
      />
    ),
    enableSorting: !column.masked,
    size: column.isTimestamp ? 170 : column.isJson ? 240 : column.enumValues ? 120 : 160,
    meta: column.isJson ? { grow: true } : {},
    cell: ({ row }) => <Cell column={column} value={row.original.cells[column.name] ?? null} />,
  }));
}

/** A value as its column's kind reads: a badge for an enum, a date for a timestamp, and so on. */
function Cell({ column, value }: { column: DataColumnInfo; value: DataCell }) {
  if (value === null) {
    return <span className="font-mono text-data text-subtle-foreground">null</span>;
  }
  if (column.masked) {
    return <span className="font-mono text-data text-subtle-foreground italic">{value}</span>;
  }
  if (column.enumValues) {
    return <DotBadge tone={activityEventTone(String(value)) ?? 'idle'}>{value}</DotBadge>;
  }
  if (column.isTimestamp && typeof value === 'number') {
    return (
      <span className="font-mono text-data tabular-nums" title={String(value)}>
        {formatDateTime(value)}
      </span>
    );
  }
  return (
    <span
      className={
        column.isJson ? 'font-mono text-data text-muted-foreground' : 'font-mono text-data'
      }
      title={String(value)}
    >
      {value}
    </span>
  );
}
