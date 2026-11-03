import { describe, expect, it } from 'vitest';
import { parseCommand } from '../features/commands/parseCommand.js';
import { toSafeChatText } from './safeChatText.js';

describe('toSafeChatText', () => {
  it('leaves ordinary messages alone', () => {
    expect(toSafeChatText('Death count: 3', 500)).toBe('Death count: 3');
    expect(toSafeChatText('Make one with !sg', 500)).toBe('Make one with !sg');
    expect(toSafeChatText('...and we are back', 500)).toBe('...and we are back');
  });

  it.each([
    ['a plain command', '!delvod'],
    ['a slash command', '/ban someone'],
    ['repeated prefixes', '!!/!delvod'],
    ['leading whitespace', '   !delvod'],
    ['a leading zero-width space', '​!delvod'],
    ['a leading word joiner and BOM', '⁠﻿!delvod'],
    ['a leading tag character', '\u{E0020}!delvod'],
  ])('never yields something parseCommand runs, given %s', (_case, payload) => {
    const safe = toSafeChatText(`${payload} now`, 500);
    expect(parseCommand(safe)).toBeNull();
    expect(safe).toBe(safe.trimStart());
  });

  it('refuses a message that is only a command prefix', () => {
    expect(() => toSafeChatText(' !/ ', 500)).toThrow();
  });

  it('leaves a message that exactly fits alone', () => {
    expect(toSafeChatText('x'.repeat(10), 10)).toBe('x'.repeat(10));
  });

  it('cuts a longer one to fit, ending in an ellipsis', () => {
    const cut = toSafeChatText('x'.repeat(11), 10);

    expect(cut).toBe(`${'x'.repeat(9)}…`);
    expect(Array.from(cut)).toHaveLength(10);
  });

  it('measures after stripping the prefix, and never splits an emoji', () => {
    expect(toSafeChatText(`!!!${'x'.repeat(10)}`, 10)).toBe('x'.repeat(10));
    expect(toSafeChatText('😀'.repeat(5), 3)).toBe('😀😀…');
  });
});
