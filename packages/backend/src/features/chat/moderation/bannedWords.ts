import { BAN_DURATION_MS, canonicalWord } from '@turingmod/shared';

/** Bans made at or after this time are still in force at `now`. */
export function banCutoff(now = Date.now()): number {
  return now - BAN_DURATION_MS;
}

export interface WordBan {
  word: string;
  /** Match only a whole word, rather than inside longer ones too. */
  wholeWord: boolean;
}

/** The pieces of a word, so `cat,dog` and `cat😀` still contain the whole word `cat`. */
const WORD_PIECES = /\p{Extended_Pictographic}|[\p{L}\p{N}\p{M}]+/gu;

/**
 * Adds a word in canonical form, as written and with runs of three or more of a letter shrunk to
 * one and to two, so `spiiider` is `spider` and `goood` is `good` or `god`. Only longer runs shrink,
 * so a ban on `god` doesn't catch `good`, and this comes before lookalikes are replaced, so `hill`
 * doesn't become `hiii` and then `hi`.
 */
function addForms(forms: Set<string>, text: string): void {
  for (const variant of [
    text,
    text.replace(/(.)\1{2,}/giu, '$1'),
    text.replace(/(.)\1{2,}/giu, '$1$1'),
  ]) {
    const form = canonicalWord(variant);
    if (form !== '') {
      forms.add(form);
    }
  }
}

/** Everything a message could be saying, in canonical form, one entry per word it may contain. */
function formsIn(message: string): Set<string> {
  const forms = new Set<string>();
  let spacedOut = '';
  const endSpacedOut = () => {
    if (Array.from(spacedOut).length > 1) {
      addForms(forms, spacedOut);
    }
    spacedOut = '';
  };

  for (const token of message.split(/\s+/)) {
    addForms(forms, token);
    for (const piece of token.match(WORD_PIECES) ?? []) {
      addForms(forms, piece);
    }
    // Single letters in a row spell out a word: `s p i d e r`.
    if (Array.from(canonicalWord(token)).length === 1) {
      spacedOut += token;
    } else {
      endSpacedOut();
    }
  }
  endSpacedOut();
  return forms;
}

/** The first of these bans a chat message breaks, or null if it breaks none. */
export function findBrokenBan(message: string, bans: readonly WordBan[]): string | null {
  if (bans.length === 0) {
    return null;
  }
  const forms = formsIn(message);
  const broken = bans.find(({ word, wholeWord }) => {
    const banned = canonicalWord(word);
    if (banned === '') {
      return false;
    }
    return wholeWord ? forms.has(banned) : [...forms].some((form) => form.includes(banned));
  });
  return broken?.word ?? null;
}
