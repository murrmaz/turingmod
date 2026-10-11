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
