import { defaultWholeWord } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface BannedWord {
  /** Lowercased. */
  word: string;
  bannedBy: string | null;
  /** Epoch milliseconds. */
  bannedAt: number;
  /** Matches only as a whole word, rather than inside longer ones too. */
  wholeWord: boolean;
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
    const rows = this.db.query<{
      word: string;
      banned_by: string | null;
      banned_at: number;
      whole_word: number;
    }>('SELECT word, banned_by, banned_at, whole_word FROM banned_words ORDER BY banned_at, word');
    return rows.map((row) => ({
      word: row.word,
      bannedBy: row.banned_by,
      bannedAt: row.banned_at,
      wholeWord: row.whole_word === 1,
    }));
  }

  /** Words banned at or after `since` (epoch ms), i.e. those still in force. */
  listActive(since: number): { word: string; wholeWord: boolean }[] {
    const rows = this.db.query<{ word: string; whole_word: number }>(
      'SELECT word, whole_word FROM banned_words WHERE banned_at >= ?',
      [since]
    );
    return rows.map((row) => ({ word: row.word, wholeWord: row.whole_word === 1 }));
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

  /** Change a word and how it matches, keeping who banned it and when. False if it wasn't listed. */
  update(word: string, newWord: string, wholeWord: boolean): boolean {
    const { changes } = this.db.run(
      'UPDATE banned_words SET word = ?, whole_word = ? WHERE word = ?',
      [newWord.toLowerCase(), wholeWord ? 1 : 0, word]
    );
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
  ban(
    word: string,
    bannedBy: string | null,
    bannedAt = Date.now(),
    wholeWord = defaultWholeWord(word)
  ): void {
    this.db.run(
      `INSERT INTO banned_words (word, banned_by, banned_at, whole_word) VALUES (?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET banned_by = excluded.banned_by,
         banned_at = excluded.banned_at, whole_word = excluded.whole_word`,
      [word.toLowerCase(), bannedBy, bannedAt, wholeWord ? 1 : 0]
    );
  }

  /** Unban a word. Returns false if it wasn't banned. */
  remove(word: string): boolean {
    const { changes } = this.db.run('DELETE FROM banned_words WHERE word = ?', [word]);
    return changes > 0;
  }
}
