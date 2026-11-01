import {
  type ActivityEventName,
  type ActivityLogEntry,
  ActivityLogEntrySchema,
  messageOf,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { DatabaseManager, type SqlValue } from '../DatabaseManager.js';
import { containsPattern, LIKE_ESCAPE } from '../likePattern.js';

const ACTIVITY_LOG_CAP = 5000;
const PRUNE_EVERY = 100; // run the cap-enforcing delete once per N inserts (avoids per-insert scan)
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;

/** Which stored entries to read, newest first, one page at a time; every condition given applies. */
export interface ActivityLogQuery {
  /** Only entries of these events. */
  events?: readonly ActivityEventName[];
  /** Only entries whose event name or payload contains this text (ASCII case ignored). */
  search?: string;
  /** Only entries made at or after this time, in epoch milliseconds. */
  since?: number;
  /** Zero-based. */
  page: number;
  pageSize: number;
}

/** One page of stored entries, and how many match across all pages. */
export interface ActivityLogPage {
  entries: ActivityLogEntry[];
  total: number;
}

/**
 * Database row structure for activity_log table
 */
interface ActivityLogRow {
  id: string;
  event: string;
  data: string; // JSON object
  timestamp: number;
}

/**
 * Activity log repository
 * Manages the denormalized activity feed (commands/events/status/errors; chat excluded)
 */
@singleton()
export class ActivityLogRepository {
  private insertsSincePrune = 0;

  constructor(private db: DatabaseManager) {}

  /**
   * A stored row as an entry, checked against the schema it was written with. One that doesn't
   * fit fails the read, naming the row and the fields: stored data is held to the same schema as
   * new data rather than skipped or patched up.
   */
  private rowToEntity(row: ActivityLogRow): ActivityLogEntry {
    let data: unknown;
    try {
      data = JSON.parse(row.data);
    } catch (error) {
      throw new Error(
        `Stored activity log entry ${row.id} has unreadable data: ${messageOf(error)}`
      );
    }
    const result = ActivityLogEntrySchema.safeParse({ ...row, data });
    if (!result.success) {
      throw new Error(
        `Stored activity log entry ${row.id} is invalid:\n${z.prettifyError(result.error)}`
      );
    }
    return result.data;
  }

  /**
   * Store an activity log entry under its own id, the one the console's live feed already has,
   * so a live entry and its stored copy can be matched.
   */
  create(entry: ActivityLogEntry): void {
    this.db.run(`INSERT INTO activity_log (id, event, data, timestamp) VALUES (?, ?, ?, ?)`, [
      entry.id,
      entry.event,
      JSON.stringify(entry.data),
      entry.timestamp,
    ]);

    if (++this.insertsSincePrune >= PRUNE_EVERY) {
      this.prune();
      this.insertsSincePrune = 0;
    }
  }

  /**
   * Find recent entries, most-recent-first. `before` is an exclusive timestamp cursor for
   * pagination.
   */
  findRecent(opts: { limit?: number; before?: number }): ActivityLogEntry[] {
    const limit = Math.min(opts.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (opts.before !== undefined) {
      conditions.push('timestamp < ?');
      params.push(opts.before);
    }

    let sql = 'SELECT * FROM activity_log';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.query<ActivityLogRow>(sql, params);
    return rows.map((row) => this.rowToEntity(row));
  }

  /** A page of the entries matching `query`, newest first (see ActivityLogQuery). */
  findPage(query: ActivityLogQuery): ActivityLogPage {
    const conditions: string[] = [];
    const params: SqlValue[] = [];
    if (query.events !== undefined) {
      // `IN ()` isn't SQL; no events means nothing matches.
      conditions.push(
        query.events.length === 0 ? '0' : `event IN (${query.events.map(() => '?').join(', ')})`
      );
      params.push(...query.events);
    }
    const search = query.search?.trim();
    if (search) {
      conditions.push(`(event LIKE ? ${LIKE_ESCAPE} OR data LIKE ? ${LIKE_ESCAPE})`);
      params.push(containsPattern(search), containsPattern(search));
    }
    if (query.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(query.since);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [counted] = this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM activity_log${where}`,
      params
    );
    const rows = this.db.query<ActivityLogRow>(
      `SELECT * FROM activity_log${where} ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`,
      [...params, query.pageSize, query.page * query.pageSize]
    );
    return { entries: rows.map((row) => this.rowToEntity(row)), total: counted?.total ?? 0 };
  }

  /**
   * Keep only the newest ACTIVITY_LOG_CAP rows.
   */
  private prune(): void {
    this.db.run(
      `DELETE FROM activity_log WHERE id NOT IN (
         SELECT id FROM activity_log ORDER BY timestamp DESC LIMIT ?
       )`,
      [ACTIVITY_LOG_CAP]
    );
  }
}
