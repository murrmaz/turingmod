import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DATE_RANGE_KEYS, DATE_RANGES, type DateRange } from '@/lib/dateRange';

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
