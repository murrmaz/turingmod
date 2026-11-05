import { describe, expect, it } from 'vitest';
import {
  BannedWordSchema,
  canonicalWord,
  defaultWholeWord,
  normalizeBannedWord,
} from './bannedWords.js';

describe('canonicalWord', () => {
  it.each([
    ['SPIDER', 'spider'],
    ['s.p.i.d.e.r', 'spider'],
    ['sp1d3r', 'spider'],
    ['$p1d3r', 'spider'],
    ['spïder', 'spider'],
    ['ｓｐｉｄｅｒ', 'spider'],
    ['spi​der', 'spider'],
    ['“spider”', 'spider'],
    ['he11o', canonicalWord('hello')],
  ])('makes %s the same as %s', (text, expected) => {
    expect(canonicalWord(text)).toBe(expected);
  });

  it('keeps emoji, and is empty when nothing else is left', () => {
    expect(canonicalWord('😀')).toBe('😀');
    expect(canonicalWord('!!!')).toBe('');
    expect(canonicalWord('​')).toBe('');
  });

  it('leaves numbers alone, so a ban on 1 is not the letter', () => {
    expect(canonicalWord('1')).toBe('1');
    expect(canonicalWord('420')).toBe('420');
  });
});

describe('defaultWholeWord', () => {
  it('starts words under five letters as whole-word only', () => {
    expect(defaultWholeWord('hell')).toBe(true);
    expect(defaultWholeWord('e')).toBe(true);
    expect(defaultWholeWord('😀')).toBe(true);
    expect(defaultWholeWord('there')).toBe(false);
    expect(defaultWholeWord('spider')).toBe(false);
  });
});

describe('normalizeBannedWord', () => {
  it('accepts exactly one word', () => {
    expect(normalizeBannedWord('  Cheese! ')).toBe('cheese');
    expect(normalizeBannedWord('two words')).toBeNull();
    expect(normalizeBannedWord('!!!')).toBeNull();
    expect(normalizeBannedWord('')).toBeNull();
    expect(normalizeBannedWord('​')).toBeNull();
  });

  it('keeps symbols that stand for letters, so a$$ is not a ban on a', () => {
    expect(normalizeBannedWord('a$$')).toBe('a$$');
  });

  it('drops a mention, curly punctuation and full-width forms', () => {
    expect(normalizeBannedWord('@Viewer')).toBe('viewer');
    expect(normalizeBannedWord('don’t')).toBe('dont');
    expect(normalizeBannedWord('ｓｐｉｄｅｒ')).toBe('spider');
  });

  it('accepts an emoji', () => {
    expect(normalizeBannedWord('😀')).toBe('😀');
  });
});

describe('BannedWordSchema', () => {
  it('parses to the stored form', () => {
    expect(BannedWordSchema.parse(" Don't! ")).toBe('dont');
  });

  it.each(['', '   ', '!!!', 'two words'])('refuses %j', (input) => {
    expect(BannedWordSchema.safeParse(input).error?.issues[0]?.message).toBe('One word only');
  });
});
