import { describe, expect, it } from 'vitest';
import { parseCommand } from './parseCommand.js';

describe('parseCommand', () => {
  it('splits the name from its arguments', () => {
    expect(parseCommand('!game Elden Ring')).toEqual({
      command: 'game',
      args: ['Elden', 'Ring'],
      argText: 'Elden Ring',
    });
  });

  it('lowercases the name, so capitalised commands still run', () => {
    expect(parseCommand('!Lurk')?.command).toBe('lurk');
  });

  it('has no arguments when only whitespace follows the name', () => {
    expect(parseCommand('!tags ')).toEqual({ command: 'tags', args: [], argText: '' });
  });

  it('splits on any run of whitespace, never yielding an empty argument', () => {
    expect(parseCommand('!so  @someone\t')?.args).toEqual(['@someone']);
  });

  it('keeps the spacing inside the argument text', () => {
    expect(parseCommand('!title  Day  2:  the return ')?.argText).toBe('Day  2:  the return');
  });

  it.each(['just chatting', ' !lurk', '!', '! lurk', ''])('is not a command: %j', (text) => {
    expect(parseCommand(text)).toBeNull();
  });
});
