import { useCallback, useState } from 'react';
import { type DateRange, rangeStart } from '@/lib/dateRange';

/**
 * How far back a table looks, with when that starts, worked out when the range is picked. Kept
 * rather than worked out on each render, or a time moving on would be a new query, and the table
 * would read again, and its rows move, whenever anything happened to render it.
 */
export function useDateRange() {
  const [picked, setPicked] = useState<{ range: DateRange; since: number | undefined }>({
    range: 'all',
    since: undefined,
  });
  const setRange = useCallback(
    (range: DateRange) => setPicked({ range, since: rangeStart(range) }),
    []
  );
  return { range: picked.range, since: picked.since, setRange };
}
