import { injectable, singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface BannedWord {
  /** Lowercased. */
  word: string;
  bannedBy: string | null;
  /** Epoch milliseconds. */
  bannedAt: number;
}

/** Words viewers have banned from chat with the "Ban A Word" reward. */
@injectable()
@singleton()
export class BannedWordRepository {
  constructor(private db: DatabaseManager) {}

  /** Every banned word, oldest first. */
  list(): Promise<BannedWord[]> {
    const rows = this.db.query<{ word: string; banned_by: string | null; banned_at: number }>(
      'SELECT word, banned_by, banned_at FROM banned_words ORDER BY banned_at, word'
    );
    return Promise.resolve(
      rows.map((row) => ({ word: row.word, bannedBy: row.banned_by, bannedAt: row.banned_at }))
    );
  }

  /** Ban a word. Resolves false, changing nothing, if it was already banned. */
  add(word: string, bannedBy: string | null, bannedAt = Date.now()): Promise<boolean> {
    const { changes } = this.db.run(
      'INSERT OR IGNORE INTO banned_words (word, banned_by, banned_at) VALUES (?, ?, ?)',
      [word.toLowerCase(), bannedBy, bannedAt]
    );
    return Promise.resolve(changes > 0);
  }

  /** Unban a word. Resolves false if it wasn't banned. */
  remove(word: string): Promise<boolean> {
    const { changes } = this.db.run('DELETE FROM banned_words WHERE word = ?', [word]);
    return Promise.resolve(changes > 0);
  }
}
