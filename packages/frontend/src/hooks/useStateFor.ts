import { type Dispatch, type SetStateAction, useState } from 'react';

/**
 * State that belongs to `key`, compared by value: it goes back to `initial` whenever the key
 * changes, however it changed, e.g. the page of a table whose search just changed through the URL.
 * Deriving the reset from the key means no setter has to remember it, and nothing shows the old
 * value first: React drops the render that noticed the change and renders again before painting.
 */
export function useStateFor<T>(key: unknown, initial: T): [T, Dispatch<SetStateAction<T>>] {
  // Wrapped, so that an undefined key still has a value to compare.
  const keyText = JSON.stringify([key]);
  const [value, setValue] = useState(initial);
  const [valueKey, setValueKey] = useState(keyText);
  if (keyText !== valueKey) {
    setValueKey(keyText);
    setValue(initial);
  }
  return [keyText === valueKey ? value : initial, setValue];
}
