import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  ActivityCategory,
  type DataCell,
  type DataColumnInfo,
  type DataRowsPage,
  type DataRowsQuery,
  type DataTableInfo,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import type { IService } from '../core/ServiceLifecycle.js';
import { TuringModConfig } from '../utils/Config.js';

/** What the inspector may show of one table, beyond the columns SQLite reports. */
interface TablePolicy {
  /** The column rows are ordered by when no sort is given; descending if it's a timestamp. */
  defaultSort: string;
  /** Columns whose values are never read: each cell reads as its size instead. */
  masked?: readonly string[];
  /** Rows whose `column` equals one of `keys` have their other text columns masked. */
  maskedRows?: { column: string; keys: readonly string[] };
  timestamps?: readonly string[];
  json?: readonly string[];
  /** Columns offered as a faceted filter, with the values they can take. */
  enums?: Readonly<Record<string, readonly string[]>>;
}

/**
 * The only tables the inspector reads, and how. A table missing here can't be read, whatever the
 * console asks for.
 */
const TABLES: Readonly<Record<string, TablePolicy>> = {
  activity_log: {
    defaultSort: 'timestamp',
    timestamps: ['timestamp'],
    json: ['data'],
    enums: { category: Object.values(ActivityCategory) },
  },
  integration_state: {
    defaultSort: 'name',
    // Encrypted client credentials and OAuth tokens: not even the ciphertext leaves the backend.
    masked: ['config'],
    timestamps: ['created_at', 'updated_at'],
  },
  settings: {
    defaultSort: 'key',
    timestamps: ['updated_at'],
    json: ['value'],
    // Half of what derives the encryption key.
    maskedRows: { column: 'key', keys: ['encryption_salt'] },
  },
  banned_words: { defaultSort: 'banned_at', timestamps: ['banned_at'] },
  counters: { defaultSort: 'name', timestamps: ['updated_at'] },
  interval_messages: { defaultSort: 'created_at', timestamps: ['created_at'] },
  suggestions: { defaultSort: 'created_at', timestamps: ['created_at'] },
  obs_break_restore: { defaultSort: 'saved_at', timestamps: ['saved_at'], json: ['snapshot'] },
  go_live_post: { defaultSort: 'saved_at', timestamps: ['saved_at'], json: ['post'] },
  migrations: { defaultSort: 'version' },
};

interface ColumnRow {
  name: string;
  type: string;
}

/**
 * Read-only view of the database for the console's Data page.
 *
 * Reads through its own connection, opened read-only, so nothing here can write even by mistake.
 * There is no free-form SQL: table and column names are checked against `TABLES` and the schema
 * SQLite reports, and quoted; every value is bound as a parameter.
 */
@singleton()
export class DataInspector implements IService {
  private connection: DatabaseSync | null = null;

  constructor(private config: TuringModConfig) {}

  listTables(): DataTableInfo[] {
    const existing = new Set(
      this.db()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name))
    );
    return Object.keys(TABLES)
      .filter((name) => existing.has(name))
      .map((name) => this.describe(name));
  }

  queryRows(request: DataRowsQuery): DataRowsPage {
    const table = this.describe(request.table);
    const policy = policyOf(table.name);
    const columns = new Map(table.columns.map((column) => [column.name, column]));
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    for (const [name, values] of Object.entries(request.filters ?? {})) {
      const column = this.requireColumn(columns, table.name, name);
      if (column.masked) {
        throw new Error(`Column ${name} can't be filtered`);
      }
      conditions.push(`${quote(name)} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    }

    const search = request.search?.trim();
    if (search) {
      const searchable = table.columns.filter(
        (column) => !column.masked && column.type.toUpperCase() === 'TEXT'
      );
      if (searchable.length > 0) {
        conditions.push(
          `(${searchable.map((column) => `${quote(column.name)} LIKE ? ESCAPE '\\'`).join(' OR ')})`
        );
        const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
        params.push(...searchable.map(() => pattern));
      }
    }

    if (request.since !== undefined) {
      const timeColumn = policy.timestamps?.[0];
      if (!timeColumn) {
        throw new Error(`Table ${table.name} has no time column to filter by`);
      }
      conditions.push(`${quote(timeColumn)} >= ?`);
      params.push(request.since);
    }

    const sortColumn = request.sort?.column ?? table.defaultSort;
    if (this.requireColumn(columns, table.name, sortColumn).masked) {
      throw new Error(`Column ${sortColumn} can't be sorted`);
    }

    // Masking a secret row's output isn't enough: matching or ordering on its hidden values would
    // still answer questions about them, one guess at a time. So a query that looks at any column
    // but the row's key leaves secret rows out.
    const secret = policy.maskedRows;
    if (secret) {
      const looksAtHidden =
        Boolean(search) ||
        Object.keys(request.filters ?? {}).some((name) => name !== secret.column) ||
        sortColumn !== secret.column;
      if (looksAtHidden) {
        conditions.push(
          `${quote(secret.column)} NOT IN (${secret.keys.map(() => '?').join(', ')})`
        );
        params.push(...secret.keys);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const direction =
      request.sort?.direction ?? (policy.timestamps?.includes(sortColumn) ? 'desc' : 'asc');

    const total = Number(
      this.db()
        .prepare(`SELECT COUNT(*) AS n FROM ${quote(table.name)} ${where}`)
        .get(...params)?.n ?? 0
    );

    const select = table.columns
      .map((column) =>
        column.masked
          ? `length(${quote(column.name)}) AS ${quote(column.name)}`
          : quote(column.name)
      )
      .join(', ');
    const rows = this.db()
      .prepare(
        `SELECT ${select} FROM ${quote(table.name)} ${where} ` +
          `ORDER BY ${quote(sortColumn)} ${direction === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`
      )
      .all(...params, request.pageSize, request.page * request.pageSize);

    return { rows: rows.map((row) => maskRow(row, table, policy)), total };
  }

  /** Close the read connection, so the main one can checkpoint the WAL cleanly at shutdown. */
  stop(): void {
    this.close();
  }

  close(): void {
    this.connection?.close();
    this.connection = null;
  }

  private describe(name: string): DataTableInfo {
    const policy = policyOf(name);
    const columns = this.db()
      .prepare(`PRAGMA table_info(${quote(name)})`)
      .all()
      .map((row): ColumnRow => ({ name: String(row.name), type: String(row.type) }));
    if (columns.length === 0) {
      throw new Error(`Unknown table: ${name}`);
    }

    const rowCount = Number(
      this.db()
        .prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`)
        .get()?.n ?? 0
    );
    return {
      name,
      rowCount,
      defaultSort: policy.defaultSort,
      columns: columns.map((column): DataColumnInfo => {
        const enumValues = policy.enums?.[column.name];
        return {
          name: column.name,
          type: column.type,
          masked: policy.masked?.includes(column.name) ?? false,
          isTimestamp: policy.timestamps?.includes(column.name) ?? false,
          isJson: policy.json?.includes(column.name) ?? false,
          ...(enumValues ? { enumValues: [...enumValues] } : {}),
        };
      }),
    };
  }

  private requireColumn(
    columns: Map<string, DataColumnInfo>,
    table: string,
    name: string
  ): DataColumnInfo {
    const column = columns.get(name);
    if (!column) {
      throw new Error(`Unknown column ${name} in ${table}`);
    }
    return column;
  }

  private db(): DatabaseSync {
    this.connection ??= new DatabaseSync(this.config.dbPath, { readOnly: true });
    return this.connection;
  }
}

function policyOf(name: string): TablePolicy {
  // hasOwn first, so a name like `constructor` can't reach the prototype.
  const policy = Object.hasOwn(TABLES, name) ? TABLES[name] : undefined;
  if (!policy) {
    throw new Error(`Unknown table: ${name}`);
  }
  return policy;
}

/** Turn masked cells (selected as their length) into a description, and mask secret rows. */
function maskRow(
  row: Record<string, unknown>,
  table: DataTableInfo,
  policy: TablePolicy
): Record<string, DataCell> {
  const keyColumn = policy.maskedRows?.column;
  const secretRow =
    keyColumn !== undefined && (policy.maskedRows?.keys.includes(String(row[keyColumn])) ?? false);
  const result: Record<string, DataCell> = {};
  for (const column of table.columns) {
    const value = row[column.name];
    if (column.masked) {
      result[column.name] = value === null ? null : `encrypted · ${Number(value)} B`;
    } else if (secretRow && typeof value === 'string' && column.name !== keyColumn) {
      result[column.name] = `hidden · ${Buffer.byteLength(value)} B`;
    } else {
      result[column.name] = toCell(value);
    }
  }
  return result;
}

function toCell(value: unknown): DataCell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Uint8Array) {
    return `blob · ${value.byteLength} B`;
  }
  return String(value);
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
