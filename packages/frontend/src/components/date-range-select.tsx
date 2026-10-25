import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DAY = 24 * 60 * 60 * 1000;

const DATE_RANGES = {
  today: { label: 'Today', since: () => new Date().setHours(0, 0, 0, 0) },
  week: { label: 'Last 7 days', since: () => Date.now() - 7 * DAY },
  month: { label: 'Last 30 days', since: () => Date.now() - 30 * DAY },
  all: { label: 'All time', since: () => undefined },
} satisfies Record<string, { label: string; since: () => number | undefined }>;

export type DateRange = keyof typeof DATE_RANGES;

const DATE_RANGE_KEYS = Object.keys(DATE_RANGES) as DateRange[];

/**
 * When a range starts, for a query's `since`; undefined for all time. Rounded down to the minute,
 * so a query built from it changes (and is sent again) at most once a minute.
 */
export function rangeStart(range: DateRange): number | undefined {
  const since = DATE_RANGES[range].since();
  return since === undefined ? undefined : Math.floor(since / 60_000) * 60_000;
}

/** Picks how far back a table looks. */
export function DateRangeSelect({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const range = DATE_RANGE_KEYS.find((key) => key === next);
        if (range) {
          onChange(range);
        }
      }}
    >
      <SelectTrigger className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DATE_RANGE_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            {DATE_RANGES[key].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
