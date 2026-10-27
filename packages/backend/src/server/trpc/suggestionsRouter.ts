import { z } from 'zod';
import type { SuggestionBox } from '../../suggestions/SuggestionBox.js';
import { procedure, router } from './trpc.js';
import { watchable } from './watch.js';

/**
 * Viewers' suggestions, for the console's Suggestions page. `delete` answers with the list it
 * left, so the console that asked can show it at once; every other console gets it through
 * `watch`. Undo is the console's: it holds a delete back until its Undo has lapsed.
 */
export function createSuggestionsRouter(box: SuggestionBox) {
  const suggestions = watchable(
    () => box.list(),
    (onChange) => box.onChange(onChange)
  );

  return router({
    /** Every suggestion, newest first, sent on subscribing and again whenever one changes. */
    watch: procedure.subscription(({ signal }) => suggestions.watch(signal)),

    /** Delete these suggestions; ones already gone are skipped. */
    delete: procedure
      .input(z.strictObject({ ids: z.array(z.int().positive()).min(1) }))
      .mutation(({ input }) => {
        box.delete(input.ids);
        return suggestions.current();
      }),
  });
}
