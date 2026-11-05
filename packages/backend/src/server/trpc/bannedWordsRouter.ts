import { BannedWordSchema } from '@turingmod/shared';
import { z } from 'zod';
import type { EventBus } from '../../core/EventBus.js';
import type { BannedWordList } from '../../features/chat/moderation/BannedWordList.js';
import { procedure, router } from './trpc.js';
import { watchable } from './watch.js';

/**
 * The banned words, for the console's Banned Words page. Every mutation answers with the list it
 * left, so the console that asked can show it at once; every other console gets it through `watch`.
 */
export function createBannedWordsRouter(words: BannedWordList, eventBus: EventBus) {
  const list = watchable(
    () => words.list(),
    (onChange) => eventBus.on('bannedWords.changed', onChange)
  );

  return router({
    /** Every listed word, lapsed ones included, sent on subscribing and again on each change. */
    watch: procedure.subscription(({ signal }) => list.watch(signal)),

    /** Ban a word for a month, on the streamer's own account. */
    add: procedure
      .input(z.strictObject({ word: BannedWordSchema, wholeWord: z.boolean() }))
      .mutation(({ input }) => {
        words.ban(input.word, null, input.wholeWord);
        return list.current();
      }),

    /** Correct a word's spelling or how it matches, keeping who banned it and when. */
    update: procedure
      .input(
        z.strictObject({
          word: BannedWordSchema,
          newWord: BannedWordSchema,
          wholeWord: z.boolean(),
        })
      )
      .mutation(({ input }) => {
        words.update(input.word, input.newWord, input.wholeWord);
        return list.current();
      }),

    /** Restart a word's month. */
    renew: procedure.input(z.strictObject({ word: BannedWordSchema })).mutation(({ input }) => {
      words.renew(input.word);
      return list.current();
    }),

    /** Delete these words; ones already gone are skipped. */
    delete: procedure
      .input(z.strictObject({ words: z.array(BannedWordSchema).min(1) }))
      .mutation(({ input }) => {
        words.remove(input.words);
        return list.current();
      }),
  });
}
