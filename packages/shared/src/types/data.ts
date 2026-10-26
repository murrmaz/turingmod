import { z } from 'zod';

/**
 * What the console's Data page reads through the backend's read-only data inspector
 * (DataInspector): the tables it may show, and pages of their rows.
 */

/** One column of an inspectable table. */
export interface DataColumnInfo {
  name: string;
  /** SQLite declared type, e.g. TEXT or INTEGER */
  type: string;
  /** The value is never sent: a masked column reads as its size instead. */
  masked: boolean;
  /** The values this column can take, for columns the console offers as a filter. */
  enumValues?: string[];
  /** Holds epoch-millisecond timestamps. */
  isTimestamp: boolean;
  /** Holds JSON text. */
  isJson: boolean;
}

/** One inspectable table. */
export interface DataTableInfo {
  name: string;
  rowCount: number;
  columns: DataColumnInfo[];
  /** The column rows are ordered by when no sort is given (newest first if it's a timestamp). */
  defaultSort: string;
}

/** A cell as sent to the console: masked columns arrive as a description of their size. */
export type DataCell = string | number | null;

/** One page of a table's rows. */
export interface DataRowsPage {
  rows: Record<string, DataCell>[];
  /** Rows matching the filters, across all pages */
  total: number;
}

/** Most rows one data page may return. */
export const MAX_DATA_PAGE_SIZE = 200;

/**
 * A page of one table to read. Table and column names are checked against the tables the backend
 * allows inspecting; values are only ever bound as parameters.
 */
export const DataRowsQuerySchema = z.strictObject({
  table: z.string().min(1),
  /** Zero-based page number */
  page: z.int().nonnegative(),
  pageSize: z.int().positive().max(MAX_DATA_PAGE_SIZE),
  sort: z
    .strictObject({
      column: z.string().min(1),
      direction: z.enum(['asc', 'desc']),
    })
    .exactOptional(),
  /** Keep rows whose column equals one of the listed values, per column */
  filters: z.record(z.string(), z.array(z.string()).min(1)).exactOptional(),
  /** Text matched anywhere in the table's unmasked text columns */
  search: z.string().exactOptional(),
  /** Only rows at or after this epoch-ms time, on the table's timestamp column */
  since: z.number().exactOptional(),
});
export type DataRowsQuery = z.infer<typeof DataRowsQuerySchema>;
