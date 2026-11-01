/** `HH:MM:SS` in local time. */
export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** `YYYY-MM-DD HH:MM:SS` in local time. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(timestamp)}`;
}

/** The day a timestamp falls on, in local time, as `YYYY-MM-DD`: equal for any two on one day. */
export function dayOf(timestamp: number): string {
  return formatDateTime(timestamp).slice(0, 10);
}

/** The day a timestamp falls on, as the activity tables' dividers name it. */
export function formatDay(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const named = date.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
  if (dayOf(timestamp) === dayOf(now)) {
    return `Today · ${named}`;
  }
  if (dayOf(timestamp) === dayOf(yesterday.getTime())) {
    return `Yesterday · ${named}`;
  }
  return named;
}

/** `H:MM:SS` for a duration in milliseconds. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
