import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Suppress console output from passing tests; still shown for failures,
    // so a broken test's logs remain visible for debugging.
    silent: 'passed-only',
  },
});
