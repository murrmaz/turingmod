import { useMemo } from 'react';
import type { RouterOutputs } from '@/context/trpc-context';
import { useSubscription } from '@/hooks/useSubscription';
import { useUndoableDelete } from '@/hooks/useUndoableDelete';
import { plural } from '@/lib/plural';

export type Suggestion = RouterOutputs['suggestions']['delete'][number];

const NONE: Suggestion[] = [];

/** Viewers' suggestions, newest first, and deleting them with Undo. */
export function useSuggestions() {
  const [all, show, status] = useSubscription(
    (client, on) => client.suggestions.watch.subscribe(undefined, on),
    NONE,
    "Couldn't read suggestions"
  );
  const { hidden, remove } = useUndoableDelete(
    (client, ids) => client.suggestions.delete.mutate({ ids }).then(show),
    (count) => plural(count, 'suggestion')
  );

  const suggestions = useMemo(() => all.filter((s) => !hidden.has(s.id)), [all, hidden]);
  return { suggestions, status, remove };
}
