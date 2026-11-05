import { BAN_DURATION_MS, defaultWholeWord } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { banCutoff, findBrokenBan } from './bannedWords.js';

describe('banCutoff', () => {
  it('keeps a ban in force for thirty days', () => {
    expect(BAN_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(banCutoff(BAN_DURATION_MS + 5)).toBe(5);
  });
});

/** A ban as a new one starts: partial from five letters, whole-word below that. */
const ban = (word: string) => ({ word, wholeWord: defaultWholeWord(word) });
const whole = (word: string) => ({ word, wholeWord: true });
const partial = (word: string) => ({ word, wholeWord: false });

describe('findBrokenBan', () => {
  it.each([
    'SPIDER',
    'a spider, really',
    's.p.i.d.e.r',
    'spiders',
    'Spiders',
    'spiderman',
    'sp1d3r',
    '$p1d3r',
    'spïder',
    'ｓｐｉｄｅｒ',
    'spi​der',
    '“spider”',
    'spiiiider',
    'SPIIIIDER',
    's p i d e r',
    'look: s p 1 d 3 r!',
    'sp1der_fan',
    '@spider',
    '!title spider',
  ])('catches %j for a ban on spider', (message) => {
    expect(findBrokenBan(message, [ban('spider')])).toBe('spider');
  });

  it.each(['spyder', 'sipder', 'spi der', 'spiidr', 'hello there'])(
    'lets %j through for a ban on spider',
    (message) => {
      expect(findBrokenBan(message, [ban('spider')])).toBeNull();
    }
  );

  describe('a whole-word ban', () => {
    it.each(['hell', 'HELL', 'h3ll', 'h e l l', 'what the hell?', 'helllll', 'hell,no', 'hell😀'])(
      'catches %j',
      (message) => {
        expect(findBrokenBan(message, [whole('hell')])).toBe('hell');
      }
    );

    it.each(['hello', 'shell', 'hellish'])('does not catch %j', (message) => {
      expect(findBrokenBan(message, [whole('hell')])).toBeNull();
    });

    it('holds a long word to the whole word too', () => {
      expect(findBrokenBan('therefore', [whole('there')])).toBeNull();
      expect(findBrokenBan('over there', [whole('there')])).toBe('there');
    });
  });

  it('matches a short word inside longer ones when told to', () => {
    expect(findBrokenBan('cats', [partial('cat')])).toBe('cat');
    expect(findBrokenBan('cats', [whole('cat')])).toBeNull();
  });

  describe('common words a short ban must not catch', () => {
    it.each([
      ['ass', 'class'],
      ['ass', 'grass'],
      ['e', 'hello there'],
      ['a', 'this is fine'],
      ['hi', 'hill'],
      ['hi', 'hilly chill'],
      ['god', 'good'],
      ['pop', 'poop'],
      ['to', 'too'],
      ['i', 'ill'],
    ])('a ban on %s lets %j through', (word, message) => {
      expect(findBrokenBan(message, [ban(word)])).toBeNull();
    });
  });

  it('reads a symbol in a ban as the letter it stands for', () => {
    expect(findBrokenBan('ass', [ban('a$$')])).toBe('a$$');
    expect(findBrokenBan('a', [ban('a$$')])).toBeNull();
  });

  it('still finds a word beside a mention or a symbol', () => {
    expect(findBrokenBan('@cat', [ban('cat')])).toBe('cat');
    expect(findBrokenBan('cat$', [ban('cat')])).toBe('cat');
    expect(findBrokenBan('dog,cat', [ban('cat')])).toBe('cat');
  });

  it('treats numbers as numbers', () => {
    expect(findBrokenBan('420', [ban('420')])).toBe('420');
    expect(findBrokenBan('I', [ban('1')])).toBeNull();
    expect(findBrokenBan('1', [ban('1')])).toBe('1');
  });

  it('matches emoji, on their own or against a word', () => {
    expect(findBrokenBan('nice 😀', [ban('😀')])).toBe('😀');
    expect(findBrokenBan('nice😀', [ban('😀')])).toBe('😀');
    expect(findBrokenBan('😀😀😀', [ban('😀')])).toBe('😀');
    expect(findBrokenBan('nice', [ban('😀')])).toBeNull();
  });

  it('never matches a ban with nothing left to compare', () => {
    expect(findBrokenBan('anything at all', [partial('!!!')])).toBeNull();
  });

  it('answers with the ban as stored, not how the viewer spelled it', () => {
    expect(findBrokenBan('SP1D3RS', [ban('spider')])).toBe('spider');
  });

  it('copes with an empty message or no bans', () => {
    expect(findBrokenBan('', [ban('spider')])).toBeNull();
    expect(findBrokenBan('spider', [])).toBeNull();
  });
});
