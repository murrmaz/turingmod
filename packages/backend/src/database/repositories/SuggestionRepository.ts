import { singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';
import { deleteByIds } from '../deleteByIds.js';

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
  list(): Suggestion[] {
    return this.db
      .query<SuggestionRow>(
        'SELECT id, suggestion, suggested_by, created_at FROM suggestions ORDER BY id DESC'
      )
      .map(toSuggestion);
  }

  /** Delete the suggestions with these ids; ones already gone are skipped. Returns how many went. */
  remove(ids: readonly number[]): number {
    return deleteByIds(this.db, 'suggestions', ids);
  }
}
