import { singleton } from 'tsyringe';
import {
  type Suggestion,
  SuggestionRepository,
} from '../database/repositories/SuggestionRepository.js';

/**
 * Viewers' suggestions for the bot, collected with `!sg` and reviewed on the console's
 * Suggestions page. Everything that adds or deletes one goes through here, so the console
 * (`suggestions.watch`) hears about every change.
 */
@singleton()
export class SuggestionBox {
  private readonly changeListeners = new Set<() => void>();

  constructor(private suggestions: SuggestionRepository) {}

  /** Be told whenever a suggestion is added or deleted. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  add(suggestion: string, suggestedBy: string | null): void {
    this.suggestions.add(suggestion, suggestedBy);
    this.changed();
  }

  /** Every suggestion, newest first. */
  list(): Suggestion[] {
    return this.suggestions.all();
  }

  /** The most recent `limit` suggestions, newest first. */
  latest(limit: number): Suggestion[] {
    return this.suggestions.latest(limit);
  }

  /** Delete the suggestions with these ids; ones already gone are skipped. */
  delete(ids: readonly number[]): void {
    if (this.suggestions.delete(ids) > 0) {
      this.changed();
    }
  }

  private changed(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }
}
