import { type DataCell, type DataTableInfo, MAX_DATA_PAGE_SIZE } from '@turingmod/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTrpc } from '@/context/trpc-context';
import { toCsv } from '@/lib/csv';
import { saveFile } from '@/lib/download';
import { reportActionError } from '@/lib/reportError';
import type { InspectorQuery } from './useInspectedTable';

/** The most rows one export reads: fifty of the backend's largest pages. */
export const MAX_EXPORT_ROWS = 50 * MAX_DATA_PAGE_SIZE;

/**
 * Exporting what the Data page reads of a table as CSV, every page of it up to MAX_EXPORT_ROWS;
 * an export that stops there says so.
 */
export function useTableExport(info: DataTableInfo, query: InspectorQuery, total: number) {
  const trpc = useTrpc();
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: Record<string, DataCell>[] = [];
      for (let page = 0; rows.length < Math.min(total, MAX_EXPORT_ROWS); page++) {
        const read = await trpc.data.queryRows.query({
          ...query,
          page,
          pageSize: MAX_DATA_PAGE_SIZE,
        });
        rows.push(...read.rows);
        if (read.rows.length < MAX_DATA_PAGE_SIZE) {
          break;
        }
      }
      saveFile(`${info.name}.csv`, toCsv(info.columns, rows), 'text/csv;charset=utf-8');
      if (total > rows.length) {
        toast.warning(`Exported the first ${rows.length.toLocaleString()} rows`, {
          description: `${total.toLocaleString()} match; narrow the search or time range to export the rest.`,
        });
      }
    } catch (error) {
      reportActionError(`Couldn't export ${info.name}`, error);
    } finally {
      setExporting(false);
    }
  };

  return { exporting, exportCsv };
}
