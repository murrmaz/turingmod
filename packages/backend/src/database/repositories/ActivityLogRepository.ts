import {
  type ActivityCategory,
  type ActivityLogEntry,
  ActivityLogEntrySchema,
  messageOf,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { DatabaseManager, type SqlValue } from '../DatabaseManager.js';

const ACTIVITY_LOG_CAP = 5000;
const PRUNE_EVERY = 100; // run the cap-enforcing delete once per N inserts (avoids per-insert scan)
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;

/**
 * Database row structure for activity_log table
 */
interface ActivityLogRow {
  id: string;
  category: string;
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
    this.db.run(
      `INSERT INTO activity_log (id, category, event, data, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [entry.id, entry.category, entry.event, JSON.stringify(entry.data), entry.timestamp]
    );

    if (++this.insertsSincePrune >= PRUNE_EVERY) {
      this.prune();
      this.insertsSincePrune = 0;
    }
  }

  /**
   * Find recent entries, most-recent-first. `before` is an exclusive timestamp cursor for
   * pagination.
   */
  findRecent(opts: {
    limit?: number;
    category?: ActivityCategory;
    before?: number;
  }): ActivityLogEntry[] {
    const limit = Math.min(opts.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (opts.category !== undefined) {
      conditions.push('category = ?');
      params.push(opts.category);
    }
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
