import { injectable, singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface IntervalMessage {
  name: string;
  message: string;
  createdBy: string | null;
}

/** Announcements posted to chat on a rotation, in the order they were added. */
@injectable()
@singleton()
export class IntervalMessageRepository {
  constructor(private db: DatabaseManager) {}

  list(): IntervalMessage[] {
    const rows = this.db.query<{ name: string; message: string; created_by: string | null }>(
      'SELECT name, message, created_by FROM interval_messages ORDER BY id'
    );
    return rows.map((row) => ({ name: row.name, message: row.message, createdBy: row.created_by }));
  }

  /** Add a message to the end of the rotation. Returns false if the name is taken. */
  add(name: string, message: string, createdBy: string | null): boolean {
    const { changes } = this.db.run(
      `INSERT OR IGNORE INTO interval_messages (name, message, created_by, created_at)
       VALUES (?, ?, ?, ?)`,
      [name, message, createdBy, Date.now()]
    );
    return changes > 0;
  }

  /** Replace a message's text, keeping its place. Returns false if there's no such message. */
  update(name: string, message: string): boolean {
    const { changes } = this.db.run('UPDATE interval_messages SET message = ? WHERE name = ?', [
      message,
      name,
    ]);
    return changes > 0;
  }

  remove(name: string): boolean {
    const { changes } = this.db.run('DELETE FROM interval_messages WHERE name = ?', [name]);
    return changes > 0;
  }
}
