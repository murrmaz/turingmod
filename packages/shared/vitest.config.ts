import { defineConfig } from 'vitest/config';
import { COVERAGE } from '../../vitest.coverage.ts';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: COVERAGE,
  },
});
