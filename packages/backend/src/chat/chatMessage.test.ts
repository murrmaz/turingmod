import { describe, expect, it } from 'vitest';
import { parseCommand } from '../commands/parseCommand.js';
import { toSafeChatText } from './chatMessage.js';

describe('toSafeChatText', () => {
  it('leaves ordinary messages alone', () => {
    expect(toSafeChatText('Death count: 3')).toBe('Death count: 3');
    expect(toSafeChatText('Make one with !sg')).toBe('Make one with !sg');
    expect(toSafeChatText('...and we are back')).toBe('...and we are back');
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
    const safe = toSafeChatText(`${payload} now`);
    expect(parseCommand(safe)).toBeNull();
    expect(safe).toBe(safe.trimStart());
  });

  it('refuses a message that is only a command prefix', () => {
    expect(() => toSafeChatText(' !/ ')).toThrow();
  });
});
