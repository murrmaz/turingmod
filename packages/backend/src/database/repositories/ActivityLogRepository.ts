import type { ActivityCategory, ActivityLogEntry } from '@turingmod/shared';
import type { DatabaseManager, SqlValue } from '../DatabaseManager.js';

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
export class ActivityLogRepository {
  private insertsSincePrune = 0;

  constructor(private db: DatabaseManager) {}

  /**
   * Convert database row to ActivityLogEntry entity
   */
  private rowToEntity(row: ActivityLogRow): ActivityLogEntry {
    return {
      id: row.id,
      category: row.category as ActivityCategory,
      event: row.event,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
    };
  }

  /**
   * Create an activity log entry
   */
  create(entry: Omit<ActivityLogEntry, 'id'>): Promise<ActivityLogEntry> {
    const id = crypto.randomUUID();

    this.db.run(
      `INSERT INTO activity_log (id, category, event, data, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [id, entry.category, entry.event, JSON.stringify(entry.data), entry.timestamp]
    );

    if (++this.insertsSincePrune >= PRUNE_EVERY) {
      this.prune();
      this.insertsSincePrune = 0;
    }

    return Promise.resolve({ id, ...entry });
  }

  /**
   * Find recent entries, most-recent-first. `before` is an exclusive timestamp cursor for
   * pagination.
   */
  findRecent(opts: {
    limit?: number;
    category?: ActivityCategory;
    before?: number;
  }): Promise<ActivityLogEntry[]> {
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
    return Promise.resolve(rows.map((row) => this.rowToEntity(row)));
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
