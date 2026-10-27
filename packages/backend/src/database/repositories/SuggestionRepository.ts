import { singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

export interface Suggestion {
  id: number;
  suggestion: string;
  suggestedBy: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
}

interface SuggestionRow {
  id: number;
  suggestion: string;
  suggested_by: string | null;
  created_at: number;
}

const toSuggestion = (row: SuggestionRow): Suggestion => ({
  id: row.id,
  suggestion: row.suggestion,
  suggestedBy: row.suggested_by,
  createdAt: row.created_at,
});

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

  /** Every suggestion, newest first. */
  all(): Suggestion[] {
    return this.db
      .query<SuggestionRow>(
        'SELECT id, suggestion, suggested_by, created_at FROM suggestions ORDER BY id DESC'
      )
      .map(toSuggestion);
  }

  /** The most recent `limit` suggestions, newest first. */
  latest(limit: number): Suggestion[] {
    return this.db
      .query<SuggestionRow>(
        'SELECT id, suggestion, suggested_by, created_at FROM suggestions ORDER BY id DESC LIMIT ?',
        [limit]
      )
      .map(toSuggestion);
  }

  /** Delete the suggestions with these ids; ones already gone are skipped. Returns how many went. */
  delete(ids: readonly number[]): number {
    if (ids.length === 0) {
      return 0;
    }
    const placeholders = ids.map(() => '?').join(', ');
    return this.db.run(`DELETE FROM suggestions WHERE id IN (${placeholders})`, [...ids]).changes;
  }
}
