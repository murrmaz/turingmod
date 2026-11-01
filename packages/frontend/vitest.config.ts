import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Suppress console output from passing tests; still shown for failures,
    // so a broken test's logs remain visible for debugging.
    silent: 'passed-only',
    projects: [
      {
        // Pure functions and classes, with no DOM.
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        // Components and hooks, rendered with Testing Library (helpers in src/testing/).
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          // More than `asyncUtilTimeout` (setupDom.ts), so a failed wait reports what it wanted.
          testTimeout: 20_000,
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/testing/setupDom.ts'],
        },
      },
    ],
  },
});
