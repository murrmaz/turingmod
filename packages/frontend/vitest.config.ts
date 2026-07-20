import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // No test files yet — component tests will need `jsdom` +
    // `@testing-library/react` added when the first one is written.
    passWithNoTests: true,
  },
});
