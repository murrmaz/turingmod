import { type RefObject, useEffect } from 'react';

/**
 * Focus an element when `key` is pressed, unless something is being typed into or a dialog is
 * over it: "/" for a page's filter, as on many sites.
 */
export function useFocusShortcut(ref: RefObject<HTMLElement | null>, key = '/'): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const busy = target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"]'
      );
      if (event.key === key && !busy && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ref, key]);
}
