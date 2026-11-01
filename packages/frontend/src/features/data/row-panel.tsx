import type { DataCell, DataTableInfo } from '@turingmod/shared';
import { Copy, Shield } from 'lucide-react';
import { DetailPanel } from '@/components/detail-panel';
import { Button } from '@/components/ui/button';
import type { InspectedRow } from '@/hooks/useInspectedTable';
import { copyToClipboard } from '@/lib/clipboard';
import { formatDateTime } from '@/lib/time';

function prettyJson(value: DataCell): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return null;
  }
}

/** Everything in one row, its JSON columns pretty-printed, beside the table. */
export function RowPanel({
  info,
  row,
  onClose,
}: {
  info: DataTableInfo;
  row: InspectedRow;
  onClose: () => void;
}) {
  const jsonColumns = info.columns.filter((column) => column.isJson);
  const plainColumns = info.columns.filter((column) => !column.isJson);
  const cells = row.cells;
  const first = info.columns[0];
  const title = cells.event ?? cells.name ?? cells.key ?? (first ? cells[first.name] : null);

  return (
    <DetailPanel
      title={String(title ?? 'Row')}
      subtitle={
        first &&
        title !== cells[first.name] && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {String(cells[first.name])}
          </p>
        )
      }
      onClose={onClose}
    >
      <dl className="flex flex-col text-body">
        {plainColumns.map((column) => {
          const value = cells[column.name] ?? null;
          return (
            <div key={column.name} className="flex gap-4 border-b py-2.5">
              <dt className="shrink-0 text-muted-foreground">{column.name}</dt>
              <dd className="ml-auto min-w-0 text-right font-mono text-data break-all">
                {column.isTimestamp && typeof value === 'number' ? (
                  <>
                    <span className="block">{formatDateTime(value)}</span>
                    <span className="block text-muted-foreground">{value}</span>
                  </>
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {jsonColumns.map((column) => {
        const value = cells[column.name] ?? null;
        const pretty = prettyJson(value);
        return (
          <div key={column.name} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-medium">{column.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-muted-foreground"
                onClick={() => void copyToClipboard(pretty ?? String(value), 'JSON')}
              >
                <Copy />
                Copy JSON
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-data leading-relaxed">
              {pretty ?? String(value)}
            </pre>
          </div>
        );
      })}

      <p className="mt-auto flex gap-2.5 rounded-lg border p-3 text-xs text-muted-foreground">
        <Shield className="size-4 shrink-0" />
        <span>
          Read-only connection. Encrypted columns like{' '}
          <code className="font-mono text-foreground">integration_state.config</code> are never
          decrypted for display.
        </span>
      </p>
    </DetailPanel>
  );
}
