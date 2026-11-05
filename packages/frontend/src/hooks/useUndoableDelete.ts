import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type TrpcClient, useTrpc } from '@/context/trpc-context';
import { PendingDeletes } from '@/lib/pendingDeletes';
import { reportActionError } from '@/lib/reportError';

/** How long a delete can be undone before it's sent. */
const UNDO_MS = 5000;

/**
 * Deleting rows with Undo. `remove` hides them at once (the caller leaves out what's in `hidden`)
 * but they're sent only when the Undo toast closes, so Undo never has to put anything back. If the
 * send fails, they reappear. Leaving the page sends every delete still waiting, so no Undo outlives
 * the page it belongs to. Closing or reloading the tab can't: tRPC sends on a timer, which never
 * fires while the page unloads, so those rows are simply still there next time.
 *
 * @param sendDelete sends a delete, and shows what the backend answers with
 * @param describe names what's being deleted for the toasts, e.g. `3 suggestions`
 */
export function useUndoableDelete<Id extends string | number = number>(
  sendDelete: (client: TrpcClient, ids: Id[]) => Promise<unknown>,
  describe: (count: number) => string
) {
  const trpc = useTrpc();
  const [pending] = useState(() => new PendingDeletes<Id>());
  const [hidden, setHidden] = useState(() => pending.hidden());
  const refresh = useCallback(() => setHidden(pending.hidden()), [pending]);

  // Read when sending, so a new client (Retry) or a caller's new function doesn't count as leaving
  // the page below. A ref, not an Effect Event, since a toast's callbacks send too, and they aren't
  // an effect.
  const latest = useRef({ trpc, sendDelete, describe });
  useEffect(() => {
    latest.current = { trpc, sendDelete, describe };
  }, [trpc, sendDelete, describe]);

  const send = useCallback(
    (key: string, ids: readonly Id[]) => {
      const current = latest.current;
      current
        .sendDelete(current.trpc, [...ids])
        .catch((error: unknown) =>
          reportActionError(`Couldn't delete ${current.describe(ids.length)}`, error)
        )
        .finally(() => {
          pending.settle(key);
          refresh();
        });
    },
    [pending, refresh]
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
    (ids: readonly Id[]) => {
      if (ids.length === 0) {
        return;
      }
      const key = pending.hold(ids);
      refresh();
      // "Deleting", not "Deleted": nothing is deleted until the toast closes.
      toast(`Deleting ${latest.current.describe(ids.length)}…`, {
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

  return { hidden, remove };
}
