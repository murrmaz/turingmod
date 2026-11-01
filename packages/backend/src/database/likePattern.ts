/**
 * A `LIKE` pattern matching text that contains `text` anywhere, its own `%`, `_` and `\` taken
 * literally. Use it with `LIKE ? ESCAPE '\'` (LIKE_ESCAPE). SQLite's LIKE ignores case for ASCII
 * letters only.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** The ESCAPE clause containsPattern() is written for. */
export const LIKE_ESCAPE = "ESCAPE '\\'";
