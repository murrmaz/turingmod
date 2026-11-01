/** A count and what it counts, e.g. `1 event` or `1,204 events`. */
export function plural(count: number, one: string): string {
  return `${count.toLocaleString()} ${one}${count === 1 ? '' : 's'}`;
}
