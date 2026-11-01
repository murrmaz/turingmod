import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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

// Testing Library only unmounts by itself when Vitest's globals are on, which they aren't here.
afterEach(() => {
  cleanup();
});
