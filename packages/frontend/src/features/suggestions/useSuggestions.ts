import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type RouterOutputs, useTrpc } from '@/context/trpc-context';
import { useSubscription } from '@/hooks/useSubscription';
import { PendingDeletes } from '@/lib/pendingDeletes';
import { plural } from '@/lib/plural';
import { reportActionError } from '@/lib/reportError';

export type Suggestion = RouterOutputs['suggestions']['delete'][number];

/** How long a delete can be undone before it's sent. */
const UNDO_MS = 5000;
const NONE: Suggestion[] = [];

/**
 * Viewers' suggestions, newest first, and deleting them with Undo.
 *
 * A delete hides its suggestions at once but is sent only when its Undo toast closes, so Undo
 * never has to put anything back. If the send fails, they reappear. Leaving the page sends every
 * delete still waiting, so no Undo outlives the page it belongs to. Closing or reloading the tab
 * can't: tRPC sends on a timer, which never fires while the page unloads, so those suggestions
 * are simply still there next time.
 */
export function useSuggestions() {
  const trpc = useTrpc();
  const [all, show] = useSubscription(
    (client, on) => client.suggestions.watch.subscribe(undefined, on),
    NONE,
    "Couldn't read suggestions"
  );
  const [pending] = useState(() => new PendingDeletes());
  const [hidden, setHidden] = useState(() => pending.hidden());
  const refresh = useCallback(() => setHidden(pending.hidden()), [pending]);

  // Read when sending, so a new client (Retry) doesn't count as leaving the page below. A ref, not
  // an Effect Event, since a toast's callbacks send too, and they aren't an effect.
  const trpcRef = useRef(trpc);
  useEffect(() => {
    trpcRef.current = trpc;
  }, [trpc]);

  const send = useCallback(
    (key: string, ids: readonly number[]) => {
      trpcRef.current.suggestions.delete
        .mutate({ ids: [...ids] })
        .then(show, (error: unknown) =>
          reportActionError(`Couldn't delete ${plural(ids.length, 'suggestion')}`, error)
        )
        .finally(() => {
          pending.settle(key);
          refresh();
        });
    },
    [pending, refresh, show]
  );

  const commit = useCallback(
    (key: string) => {
      const ids = pending.send(key);
      if (ids) {
        send(key, ids);
      }
    },
    [pending, send]
  );

  const remove = useCallback(
    (ids: readonly number[]) => {
      if (ids.length === 0) {
        return;
      }
      const key = pending.hold(ids);
      refresh();
      // "Deleting", not "Deleted": nothing is deleted until the toast closes.
      toast(`Deleting ${plural(ids.length, 'suggestion')}…`, {
        id: key,
        duration: UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (pending.undo(key)) {
              refresh();
            }
          },
        },
        onAutoClose: () => commit(key),
        onDismiss: () => commit(key),
      });
    },
    [pending, refresh, commit]
  );

  useEffect(
    () => () => {
      for (const { key, ids } of pending.sendAll()) {
        send(key, ids);
        toast.dismiss(key);
      }
    },
    [pending, send]
  );

  const suggestions = useMemo(() => all.filter((s) => !hidden.has(s.id)), [all, hidden]);
  return { suggestions, remove };
}
