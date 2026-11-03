/**
 * How every workspace reports coverage with `npm run coverage`: totals in the terminal and an
 * HTML report in its `coverage/` folder. Every source file counts, so one no test loads shows as
 * uncovered rather than missing from the report. Test helpers aren't source, so they don't count.
 */
export const COVERAGE = {
  provider: 'v8' as const,
  reporter: ['text-summary', 'html'],
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['src/testing/**', '**/testing.ts', '**/testDatabase.ts'],
};
