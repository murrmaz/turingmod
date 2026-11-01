import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Rendering a whole page is slow on a busy machine, more so when it's the first in its file. How
// long `findBy` and `waitFor` wait only matters to a test that's going to fail, so be generous.
configure({ asyncUtilTimeout: 5000 });

// jsdom lays nothing out, so every element is 0×0, and a virtualized table (the live feed) works
// out that no rows fit in its viewport. A screen-sized box lets it render its rows.
for (const [property, size] of [
  ['clientWidth', 1280],
  ['clientHeight', 800],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => size });
}

// Nor does it scroll: the feed's "new events" jump and DataTable's keeping the selected row in
// view call these, which jsdom leaves out. With no layout there's nowhere to scroll to.
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

// Nor media queries, which the sidebar asks whether the screen is narrow: it's a desktop one.
window.matchMedia = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

// Nor ResizeObserver or pointer capture, which Radix's popovers and selects use to size and
// track themselves. Nothing resizes here, and no pointer is ever captured.
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

// Testing Library only unmounts by itself when Vitest's globals are on, which they aren't here.
afterEach(() => {
  cleanup();
});
