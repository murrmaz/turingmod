import { useEffect, useState } from 'react';

/** `value` once it has stopped changing for `delayMs`, e.g. a search box's text once typing pauses. */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
