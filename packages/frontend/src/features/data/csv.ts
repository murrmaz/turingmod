import type { DataCell, DataColumnInfo } from '@turingmod/shared';

/**
 * Text a spreadsheet would run as a formula rather than show: OWASP's list of leading characters
 * for CSV injection. Stored text can come from viewers (redemption input, usernames, suggestions),
 * so `=HYPERLINK(…)` in a reward's input must not become a live link when the export is opened.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvField(value: DataCell): string {
  if (value === null) {
    return '';
  }
  // A leading apostrophe makes the spreadsheet treat the cell as text. Numbers are left alone, so
  // a stored -5 stays a number.
  const text = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows as CSV, one column per table column, safe to open in a spreadsheet. */
export function toCsv(columns: DataColumnInfo[], rows: Record<string, DataCell>[]): string {
  const header = columns.map((column) => csvField(column.name)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => csvField(row[column.name] ?? null)).join(',')
  );
  return [header, ...body].join('\r\n');
}
