const DAY = 24 * 60 * 60 * 1000;

/** How far back a table looks: today, a week, a month, or all time. */
export const DATE_RANGES = {
  today: { label: 'Today', since: () => new Date().setHours(0, 0, 0, 0) },
  week: { label: 'Last 7 days', since: () => Date.now() - 7 * DAY },
  month: { label: 'Last 30 days', since: () => Date.now() - 30 * DAY },
  all: { label: 'All time', since: () => undefined },
} satisfies Record<string, { label: string; since: () => number | undefined }>;

export type DateRange = keyof typeof DATE_RANGES;

export const DATE_RANGE_KEYS = Object.keys(DATE_RANGES) as DateRange[];

/**
 * When a range starts, for a query's `since`; undefined for all time. Rounded down to the minute,
 * so a query built from it changes (and is sent again) at most once a minute.
 */
export function rangeStart(range: DateRange): number | undefined {
  const since = DATE_RANGES[range].since();
  return since === undefined ? undefined : Math.floor(since / 60_000) * 60_000;
}
