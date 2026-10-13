/** How long a word stays banned: the "Ban A Word" reward promises a month. */
export const BAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Bans made at or after this time are still in force at `now`. */
export function banCutoff(now = Date.now()): number {
  return now - BAN_DURATION_MS;
}

/** ASCII punctuation, stripped from words before matching, as the original bot did. */
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;

/** The words in a chat message, lowercased with punctuation removed, for matching bans. */
export function wordsIn(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(PUNCTUATION, '').toLowerCase())
    .filter((word) => word !== '');
}

/** The single word a viewer asked to ban, normalized, or null if it isn't exactly one word. */
export function normalizeBannedWord(input: string): string | null {
  const words = wordsIn(input);
  return words.length === 1 ? (words[0] ?? null) : null;
}
