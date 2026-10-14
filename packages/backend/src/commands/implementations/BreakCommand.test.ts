import 'reflect-metadata';
import { PermissionLevel } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakService } from '../../breaks/BreakService.js';
import { Logger } from '../../utils/Logger.js';
import { commandContext } from '../testing.js';
import { BreakCommand } from './BreakCommand.js';

const context = (...words: string[]) =>
  commandContext(['!break', ...words].join(' '), {
    id: 'mod-1',
    platformUserId: 'mod-1',
    username: 'a_mod',
    permissionLevel: PermissionLevel.MODERATOR,
  });

describe('BreakCommand', () => {
  let breakService: {
    startBreak: ReturnType<typeof vi.fn>;
    endBreak: ReturnType<typeof vi.fn>;
  };
  let command: BreakCommand;

  beforeEach(() => {
    breakService = {
      startBreak: vi.fn(() => Promise.resolve({ extended: false, endsAt: Date.now() + 300_000 })),
      endBreak: vi.fn(() => Promise.resolve(true)),
    };
    command = new BreakCommand(
      breakService as unknown as BreakService,
      new Logger({ level: 'silent' })
    );
  });

  it.each([
    [[], 300],
    [['10'], 600],
    [['1.5'], 90],
    [['90s'], 90],
    [['2m'], 120],
  ])('starts a manual break for %j → %d seconds, replying with nothing', async (args, seconds) => {
    const result = await command.execute(context(...args));

    expect(breakService.startBreak).toHaveBeenCalledWith('manual', seconds);
    expect(result).toMatchObject({ success: true, message: '' });
  });

  it('says so when it extends a running break', async () => {
    breakService.startBreak.mockResolvedValueOnce({ extended: true, endsAt: Date.now() + 120_000 });

    const result = await command.execute(context('2'));

    expect(result.message).toBe('Break extended; back in 2m');
  });

  it('ends the break early', async () => {
    const result = await command.execute(context('end'));

    expect(breakService.endBreak).toHaveBeenCalled();
    expect(result.message).toBe('');
  });

  it('reports when there is no break to end', async () => {
    breakService.endBreak.mockResolvedValueOnce(false);

    const result = await command.execute(context('end'));

    expect(result.message).toBe('No break is running');
  });

  it.each([['soon'], ['0'], ['61']])('rejects %s', async (arg) => {
    const result = await command.execute(context(arg));

    expect(result.success).toBe(false);
    expect(breakService.startBreak).not.toHaveBeenCalled();
  });
});
