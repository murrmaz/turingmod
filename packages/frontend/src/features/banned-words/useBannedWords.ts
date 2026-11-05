import { useCallback, useMemo } from 'react';
import { type RouterOutputs, useTrpc } from '@/context/trpc-context';
import { useSubscription } from '@/hooks/useSubscription';
import { useUndoableDelete } from '@/hooks/useUndoableDelete';
import { plural } from '@/lib/plural';
import { reportActionError } from '@/lib/reportError';

export type BannedWord = RouterOutputs['bannedWords']['add'][number];

const NONE: BannedWord[] = [];

/**
 * The banned words, lapsed ones included, and changing them. Every change shows the list the
 * backend answers with. `add` and `update` reject if they fail, for the dialog that asked to show;
 * a failed `renew` is reported here, since nothing else is waiting on it.
 */
export function useBannedWords() {
  const trpc = useTrpc();
  const [all, show, status] = useSubscription(
    (client, on) => client.bannedWords.watch.subscribe(undefined, on),
    NONE,
    "Couldn't read banned words"
  );
  const { hidden, remove } = useUndoableDelete<string>(
    (client, words) => client.bannedWords.delete.mutate({ words }).then(show),
    (count) => plural(count, 'banned word')
  );

  const add = useCallback(
    async (word: string, wholeWord: boolean) =>
      show(await trpc.bannedWords.add.mutate({ word, wholeWord })),
    [trpc, show]
  );

  const update = useCallback(
    async (word: string, newWord: string, wholeWord: boolean) =>
      show(await trpc.bannedWords.update.mutate({ word, newWord, wholeWord })),
    [trpc, show]
  );

  const renew = useCallback(
    (word: string) => {
      trpc.bannedWords.renew
        .mutate({ word })
        .then(show, (error: unknown) => reportActionError(`Couldn't renew "${word}"`, error));
    },
    [trpc, show]
  );

  const words = useMemo(() => all.filter(({ word }) => !hidden.has(word)), [all, hidden]);

  return { words, status, add, update, renew, remove };
}
