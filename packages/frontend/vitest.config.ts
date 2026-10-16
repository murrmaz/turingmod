import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Component tests will need `jsdom` + `@testing-library/react` added
    // when the first one is written.
    passWithNoTests: true,
    // Suppress console output from passing tests; still shown for failures,
    // so a broken test's logs remain visible for debugging.
    silent: 'passed-only',
  },
});
