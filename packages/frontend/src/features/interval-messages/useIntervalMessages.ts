import { useCallback, useMemo } from 'react';
import { type RouterOutputs, useTrpc } from '@/context/trpc-context';
import { useSubscription } from '@/hooks/useSubscription';
import { useUndoableDelete } from '@/hooks/useUndoableDelete';
import { reportActionError } from '@/lib/reportError';

type IntervalRotation = RouterOutputs['intervalMessages']['add'];
export type IntervalMessage = IntervalRotation['messages'][number];

const EMPTY: IntervalRotation = { messages: [], nextId: null };

/**
 * The interval messages in rotation order and which is next, and changing them. Every change shows
 * the rotation the backend answers with. `add` and `update` reject if they fail, for the dialog
 * that asked to show; a failed `setEnabled` or `move` is reported here, since nothing else is
 * waiting on it.
 */
export function useIntervalMessages() {
  const trpc = useTrpc();
  const [rotation, show, status] = useSubscription(
    (client, on) => client.intervalMessages.watch.subscribe(undefined, on),
    EMPTY,
    "Couldn't read interval messages"
  );
  const { hidden, remove } = useUndoableDelete(
    (client, ids) => client.intervalMessages.delete.mutate({ ids }).then(show),
    // The page deletes one at a time, so there's no count to give.
    () => 'interval message'
  );

  const add = useCallback(
    async (message: string) => show(await trpc.intervalMessages.add.mutate({ message })),
    [trpc, show]
  );

  const update = useCallback(
    async (id: number, message: string) =>
      show(await trpc.intervalMessages.update.mutate({ id, message })),
    [trpc, show]
  );

  const setEnabled = useCallback(
    (id: number, enabled: boolean) => {
      trpc.intervalMessages.setEnabled
        .mutate({ id, enabled })
        .then(show, (error: unknown) =>
          reportActionError(`Couldn't ${enabled ? 'resume' : 'pause'} the message`, error)
        );
    },
    [trpc, show]
  );

  const move = useCallback(
    (id: number, direction: 'up' | 'down') => {
      trpc.intervalMessages.move
        .mutate({ id, direction })
        .then(show, (error: unknown) => reportActionError("Couldn't move the message", error));
    },
    [trpc, show]
  );

  const messages = useMemo(
    () => rotation.messages.filter((message) => !hidden.has(message.id)),
    [rotation.messages, hidden]
  );

  return { messages, nextId: rotation.nextId, status, add, update, setEnabled, move, remove };
}
