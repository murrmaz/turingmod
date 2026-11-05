import { describe, expect, it } from 'vitest';
import {
  BannedWordSchema,
  IntervalMessageTextSchema,
  normalizeBannedWord,
  wordsIn,
} from './chat.js';

describe('IntervalMessageTextSchema', () => {
  it('trims what it accepts', () => {
    expect(IntervalMessageTextSchema.parse('  Join the Discord ')).toBe('Join the Discord');
  });

  it('allows a command mentioned after the start', () => {
    expect(IntervalMessageTextSchema.safeParse('Type !discord to join').success).toBe(true);
  });

  it.each(['!discord to join', '/me waves', '  !discord', '​!discord'])(
    'refuses %j, which would not post as written',
    (text) => {
      expect(IntervalMessageTextSchema.safeParse(text).success).toBe(false);
    }
  );

  it('refuses an empty message', () => {
    expect(IntervalMessageTextSchema.safeParse('   ').success).toBe(false);
  });

  it('refuses a line break', () => {
    expect(IntervalMessageTextSchema.safeParse('one\ntwo').success).toBe(false);
  });

  it('counts characters rather than UTF-16 units', () => {
    expect(IntervalMessageTextSchema.safeParse('😀'.repeat(500)).success).toBe(true);
    expect(IntervalMessageTextSchema.safeParse('😀'.repeat(501)).success).toBe(false);
  });
});

describe('banned word matching', () => {
  it('splits a message into lowercased words without punctuation', () => {
    expect(wordsIn('Say "CHEESE!" now,  ok?')).toEqual(['say', 'cheese', 'now', 'ok']);
  });

  it('accepts exactly one word to ban', () => {
    expect(normalizeBannedWord('  Cheese! ')).toBe('cheese');
    expect(normalizeBannedWord('two words')).toBeNull();
    expect(normalizeBannedWord('!!!')).toBeNull();
    expect(normalizeBannedWord('')).toBeNull();
  });
});

describe('BannedWordSchema', () => {
  it('parses to the form chat is matched against', () => {
    expect(BannedWordSchema.parse(" Don't! ")).toBe('dont');
  });

  it.each(['', '   ', '!!!', 'two words'])('refuses %j', (input) => {
    expect(BannedWordSchema.safeParse(input).error?.issues[0]?.message).toBe('One word only');
  });
});
