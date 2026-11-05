import { singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';
import { deleteByIds } from '../deleteByIds.js';

export interface IntervalMessage {
  id: number;
  message: string;
  /** Whether it takes its turn in the rotation; a paused one is kept but skipped. */
  enabled: boolean;
  /** Epoch milliseconds; null if it has never been posted. */
  lastPostedAt: number | null;
  /** Epoch milliseconds. */
  createdAt: number;
}

interface IntervalMessageRow {
  id: number;
  message: string;
  enabled: number;
  last_posted_at: number | null;
  created_at: number;
}

const toIntervalMessage = (row: IntervalMessageRow): IntervalMessage => ({
  id: row.id,
  message: row.message,
  enabled: row.enabled !== 0,
  lastPostedAt: row.last_posted_at,
  createdAt: row.created_at,
});

/**
 * Announcements posted to chat on a rotation, in `position` order. A write to a single message
 * returns false if there's no such message.
 */
@singleton()
export class IntervalMessageRepository {
  constructor(private db: DatabaseManager) {}

  /** Every message, in rotation order. */
  list(): IntervalMessage[] {
    return this.db
      .query<IntervalMessageRow>(
        `SELECT id, message, enabled, last_posted_at, created_at
         FROM interval_messages ORDER BY position`
      )
      .map(toIntervalMessage);
  }

  /** Add a message to the end of the rotation. */
  add(message: string): void {
    this.db.run(
      `INSERT INTO interval_messages (message, position, created_at)
       VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM interval_messages), ?)`,
      [message, Date.now()]
    );
  }

  /** Replace a message's text, keeping its place. */
  updateText(id: number, message: string): boolean {
    return (
      this.db.run('UPDATE interval_messages SET message = ? WHERE id = ?', [message, id]).changes >
      0
    );
  }

  setEnabled(id: number, enabled: boolean): boolean {
    return (
      this.db.run('UPDATE interval_messages SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
        .changes > 0
    );
  }

  /** Swap a message with its neighbour. One already at that end of the rotation stays put. */
  move(id: number, direction: 'up' | 'down'): boolean {
    return this.db.transaction(() => {
      const own = this.db.queryOne<{ position: number }>(
        'SELECT position FROM interval_messages WHERE id = ?',
        [id]
      );
      if (!own) {
        return false;
      }
      const neighbour = this.db.queryOne<{ id: number; position: number }>(
        direction === 'up'
          ? `SELECT id, position FROM interval_messages WHERE position < ?
             ORDER BY position DESC LIMIT 1`
          : `SELECT id, position FROM interval_messages WHERE position > ?
             ORDER BY position LIMIT 1`,
        [own.position]
      );
      if (neighbour) {
        const swap = 'UPDATE interval_messages SET position = ? WHERE id = ?';
        this.db.run(swap, [neighbour.position, id]);
        this.db.run(swap, [own.position, neighbour.id]);
      }
      return true;
    });
  }

  /** Delete the messages with these ids; ones already gone are skipped. Returns how many went. */
  remove(ids: readonly number[]): number {
    return deleteByIds(this.db, 'interval_messages', ids);
  }

  markPosted(id: number, at: number): boolean {
    return (
      this.db.run('UPDATE interval_messages SET last_posted_at = ? WHERE id = ?', [at, id])
        .changes > 0
    );
  }
}
