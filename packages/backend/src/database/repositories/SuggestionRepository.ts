import { singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface Suggestion {
  suggestion: string;
  suggestedBy: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Viewers' suggestions for the bot. */
@singleton()
export class SuggestionRepository {
  constructor(private db: DatabaseManager) {}

  add(suggestion: string, suggestedBy: string | null): void {
    this.db.run('INSERT INTO suggestions (suggestion, suggested_by, created_at) VALUES (?, ?, ?)', [
      suggestion,
      suggestedBy,
      Date.now(),
    ]);
  }

  /** The most recent `limit` suggestions, newest first. */
  latest(limit: number): Suggestion[] {
    const rows = this.db.query<{
      suggestion: string;
      suggested_by: string | null;
      created_at: number;
    }>('SELECT suggestion, suggested_by, created_at FROM suggestions ORDER BY id DESC LIMIT ?', [
      limit,
    ]);
    return rows.map((row) => ({
      suggestion: row.suggestion,
      suggestedBy: row.suggested_by,
      createdAt: row.created_at,
    }));
  }
}
