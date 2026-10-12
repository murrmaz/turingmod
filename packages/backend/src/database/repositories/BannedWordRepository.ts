import { injectable, singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface BannedWord {
  /** Lowercased. */
  word: string;
  bannedBy: string | null;
  /** Epoch milliseconds. */
  bannedAt: number;
}

/**
 * Words viewers have banned from chat with the "Ban A Word" reward. Rows outlive their ban, which
 * lapses after a month (see moderation/bannedWords.ts): callers pass the cutoff, and a lapsed word
 * can be banned again.
 */
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

  /** Words banned at or after `since` (epoch ms), i.e. those still in force. */
  listActive(since: number): Promise<string[]> {
    const rows = this.db.query<{ word: string }>(
      'SELECT word FROM banned_words WHERE banned_at >= ?',
      [since]
    );
    return Promise.resolve(rows.map((row) => row.word));
  }

  /** Whether `word` was banned at or after `since`. */
  isActive(word: string, since: number): Promise<boolean> {
    const row = this.db.queryOne('SELECT 1 FROM banned_words WHERE word = ? AND banned_at >= ?', [
      word,
      since,
    ]);
    return Promise.resolve(row !== null);
  }

  /** Ban a word now, renewing a lapsed ban of the same word. */
  ban(word: string, bannedBy: string | null, bannedAt = Date.now()): Promise<void> {
    this.db.run(
      `INSERT INTO banned_words (word, banned_by, banned_at) VALUES (?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET banned_by = excluded.banned_by,
         banned_at = excluded.banned_at`,
      [word.toLowerCase(), bannedBy, bannedAt]
    );
    return Promise.resolve();
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
