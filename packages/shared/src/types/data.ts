/**
 * What the console's Data page reads through the backend's read-only data inspector
 * (DataInspector): the tables it may show, and what their rows hold.
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

/** Most rows one data page may return. */
export const MAX_DATA_PAGE_SIZE = 200;
