/**
 * JavaScript can throw anything, so a caught value is `unknown`. These are the
 * one place it gets narrowed: convert it here instead of passing `unknown` on
 * or repeating `instanceof Error` checks at each catch.
 */

/** The value as an Error: itself if it is one, otherwise wrapped, keeping the original as `cause`. */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === 'string' ? value : String(value), { cause: value });
}

/**
 * A message to show for a caught value: an Error's message, a thrown string
 * itself, or `fallback` for anything else.
 */
export function messageOf(value: unknown, fallback = 'Unknown error'): string {
  if (value instanceof Error) {
    return value.message;
  }
  return typeof value === 'string' ? value : fallback;
}
