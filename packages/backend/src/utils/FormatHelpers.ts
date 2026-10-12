/**
 * Format duration in milliseconds to human-readable string
 * Examples: "2h 34m", "45m", "1h 2m"
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format a short countdown to the second, for chat messages about imminent events.
 * Examples: "5m", "1m 30s", "45s". Unlike formatDuration, never rounds a sub-minute value to "0m".
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * Format Date to readable string for chat
 * Example: "Monday, Feb 12 at 7:00 PM"
 */
export function formatScheduleDate(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

const ELAPSED_UNITS: [name: string, ms: number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/**
 * Format a span of time in words, to its largest `parts` units, skipping empty ones.
 * Examples: "2 years, 3 months and 4 days", "1 hour and 5 minutes", "45 seconds".
 * Months are 30 days and years 365, which is plenty for "how long have you followed".
 */
export function formatElapsed(ms: number, parts = 3): string {
  let remaining = Math.max(0, Math.floor(ms / 1000) * 1000);
  const words: string[] = [];
  for (const [name, size] of ELAPSED_UNITS) {
    const count = Math.floor(remaining / size);
    remaining -= count * size;
    if (count > 0 && words.length < parts) {
      words.push(`${count} ${name}${count === 1 ? '' : 's'}`);
    }
  }
  if (words.length === 0) return '0 seconds';
  if (words.length === 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
