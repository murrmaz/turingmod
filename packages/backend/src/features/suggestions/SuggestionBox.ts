import { singleton } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import {
  type Suggestion,
  SuggestionRepository,
} from '../../database/repositories/SuggestionRepository.js';

/**
 * Viewers' suggestions for the bot, collected with `!sg` and reviewed on the console's
 * Suggestions page. Everything that adds or deletes one goes through here, so
 * `suggestions.changed`, and through it the console (`suggestions.watch`), hears of every change.
 */
@singleton()
export class SuggestionBox {
  constructor(
    private eventBus: EventBus,
    private suggestions: SuggestionRepository
  ) {}

  add(suggestion: string, suggestedBy: string | null): void {
    this.suggestions.add(suggestion, suggestedBy);
    this.eventBus.emitSync('suggestions.changed', undefined);
  }

  /** Every suggestion, newest first. */
  list(): Suggestion[] {
    return this.suggestions.all();
  }

  /** Delete the suggestions with these ids; ones already gone are skipped. */
  delete(ids: readonly number[]): void {
    if (this.suggestions.delete(ids) > 0) {
      this.eventBus.emitSync('suggestions.changed', undefined);
    }
  }
}
