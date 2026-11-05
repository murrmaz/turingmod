import { singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface BannedWord {
  /** Lowercased. */
  word: string;
  bannedBy: string | null;
  /** Epoch milliseconds. */
  bannedAt: number;
}

/**
 * Words banned from chat, by viewers with the "Ban A Word" reward or by the streamer (`bannedBy`
 * null). Rows outlive their ban, which lapses after a month (see
 * features/chat/moderation/bannedWords.ts): callers pass the cutoff, and a lapsed word can be
 * banned again.
 */
@singleton()
export class BannedWordRepository {
  constructor(private db: DatabaseManager) {}

  /** Every banned word, oldest first. */
  list(): BannedWord[] {
    const rows = this.db.query<{ word: string; banned_by: string | null; banned_at: number }>(
      'SELECT word, banned_by, banned_at FROM banned_words ORDER BY banned_at, word'
    );
    return rows.map((row) => ({
      word: row.word,
      bannedBy: row.banned_by,
      bannedAt: row.banned_at,
    }));
  }

  /** Words banned at or after `since` (epoch ms), i.e. those still in force. */
  listActive(since: number): string[] {
    const rows = this.db.query<{ word: string }>(
      'SELECT word FROM banned_words WHERE banned_at >= ?',
      [since]
    );
    return rows.map((row) => row.word);
  }

  /** Whether `word` was banned at or after `since`. */
  isActive(word: string, since: number): boolean {
    const row = this.db.queryOne('SELECT 1 FROM banned_words WHERE word = ? AND banned_at >= ?', [
      word,
      since,
    ]);
    return row !== null;
  }

  /** Whether `word` has a row, in force or lapsed. */
  has(word: string): boolean {
    return this.db.queryOne('SELECT 1 FROM banned_words WHERE word = ?', [word]) !== null;
  }

  /** Change a word, keeping who banned it and when. Returns false if it wasn't listed. */
  rename(word: string, newWord: string): boolean {
    const { changes } = this.db.run('UPDATE banned_words SET word = ? WHERE word = ?', [
      newWord.toLowerCase(),
      word,
    ]);
    return changes > 0;
  }

  /** Restart a word's ban, keeping who banned it. Returns false if it wasn't listed. */
  renew(word: string, bannedAt = Date.now()): boolean {
    const { changes } = this.db.run('UPDATE banned_words SET banned_at = ? WHERE word = ?', [
      bannedAt,
      word,
    ]);
    return changes > 0;
  }

  /** Ban a word now, renewing a lapsed ban of the same word. */
  ban(word: string, bannedBy: string | null, bannedAt = Date.now()): void {
    this.db.run(
      `INSERT INTO banned_words (word, banned_by, banned_at) VALUES (?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET banned_by = excluded.banned_by,
         banned_at = excluded.banned_at`,
      [word.toLowerCase(), bannedBy, bannedAt]
    );
  }

  /** Unban a word. Returns false if it wasn't banned. */
  remove(word: string): boolean {
    const { changes } = this.db.run('DELETE FROM banned_words WHERE word = ?', [word]);
    return changes > 0;
  }
}
