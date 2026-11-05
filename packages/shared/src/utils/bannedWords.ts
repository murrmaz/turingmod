import { z } from 'zod';

/** How long a word stays banned: the "Ban A Word" reward promises a month. */
export const BAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The fewest letters a word needs to match inside longer words by default. Below this, `ass` would
 * catch `class`, and a viewer could ban `e` and time out nearly all of chat.
 */
export const PARTIAL_MATCH_MIN_LENGTH = 5;

/** Characters that stand in for a letter. `l` and `1` both become `i`, so `he11o` is `hello`. */
const LOOKALIKES: ReadonlyMap<string, string> = new Map([
  ['0', 'o'],
  ['1', 'i'],
  ['3', 'e'],
  ['4', 'a'],
  ['5', 's'],
  ['7', 't'],
  ['@', 'a'],
  ['$', 's'],
  ['l', 'i'],
]);

const onlyLettersNumbersAndEmoji = (text: string) =>
  text.replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]/gu, '');

/**
 * What a word comes down to for comparing with chat: no accents, case, punctuation or invisible
 * characters, and lookalikes replaced, so `Sp1d3r` and `spïder` are both `spider`. Empty if nothing
 * is left. Numbers alone stay as they are: a ban on `1` shouldn't catch the word "I".
 */
export function canonicalWord(text: string): string {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const kept = onlyLettersNumbersAndEmoji(plain);
  if (/^\p{N}+$/u.test(kept)) {
    return kept;
  }
  return onlyLettersNumbersAndEmoji(
    plain.replace(/[013457@$l]/g, (character) => LOOKALIKES.get(character) ?? character)
  );
}

/** Whether a new ban of this word starts as whole-word only. */
export function defaultWholeWord(word: string): boolean {
  return Array.from(canonicalWord(word)).length < PARTIAL_MATCH_MIN_LENGTH;
}

/**
 * Punctuation left out of a stored word. `@` and `$` stay, since they can stand for letters:
 * `a$$` must not be stored as `a`, which would ban the letter. A leading `@` is a mention.
 */
const STORED_PUNCTUATION = /(?!@)[\p{P}\p{Cf}+<=>^`|~]/gu;

/** The single word someone asked to ban, in stored form, or null if it isn't exactly one word. */
export function normalizeBannedWord(input: string): string | null {
  const [first = '', ...others] = input.trim().split(/\s+/);
  if (others.length > 0) {
    return null;
  }
  const word = first
    .normalize('NFKC')
    .replace(STORED_PUNCTUATION, '')
    .replace(/^@+/, '')
    .toLowerCase();
  return canonicalWord(word) === '' ? null : word;
}

/** A word to ban, parsed to its stored form, so `Don't!` becomes `dont`. */
export const BannedWordSchema = z.string().transform((input, context) => {
  const word = normalizeBannedWord(input);
  if (word === null) {
    context.addIssue({ code: 'custom', message: 'One word only' });
    return z.NEVER;
  }
  return word;
});
