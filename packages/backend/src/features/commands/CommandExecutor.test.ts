import 'reflect-metadata';
import type { CommandResult, PlatformCapability } from '@turingmod/shared';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../core/EventBus.js';
import { InvalidStreamInfoError, NotAuthenticatedError } from '../../platforms/errors.js';
import type { Logger } from '../../utils/Logger.js';
import type { CommandAvailability } from './CommandAvailability.js';
import { CommandExecutor } from './CommandExecutor.js';
import type { CommandContext, ICommand } from './interfaces/ICommand.js';
import { commandContext, errorCodeOf } from './testing.js';

/** A viewer-readable command with a moderator-only write branch, like !game or !cw. */
const dualModeCommand = (cooldown: number): ICommand => ({
  name: 'game',
  description: 'Show or set the game',
  usage: '!game [name]',
  permissions: [PermissionLevel.VIEWER],
  cooldown,
  requiredCapabilities: [] as PlatformCapability[],
  execute: vi.fn<(context: CommandContext) => Promise<CommandResult>>(() =>
    Promise.resolve({ success: true, message: 'ok' })
  ),
});

const makeLogger = () => {
  const logger = {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger;
};

const contextFor = (permissionLevel: PermissionLevel) =>
  commandContext('!game', {
    platformUserId: `user-${permissionLevel}`,
    username: 'someone',
    permissionLevel,
  });

describe('CommandExecutor cooldowns', () => {
  let command: ICommand;
  let executor: CommandExecutor;
  let eventBus: { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    command = dualModeCommand(30);
    const availability = { find: () => command } as unknown as CommandAvailability;
    eventBus = { emit: vi.fn(() => Promise.resolve()) };
    executor = new CommandExecutor(availability, eventBus as unknown as EventBus, makeLogger());
  });

  it('throttles a viewer on the second invocation', async () => {
    const context = contextFor(PermissionLevel.VIEWER);

    const first = await executor.execute(context);
    const second = await executor.execute(context);

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(errorCodeOf(second)).toBe('COMMAND_ON_COOLDOWN');
  });

  it('throttles a viewer who sends the command again while the first run is still working', async () => {
    // Chat is handled concurrently, so a burst of `!game` arrives while the first one is still
    // waiting on Helix. Only the first may run.
    let finishFirst = () => {};
    vi.mocked(command.execute).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve({ success: true, message: 'ok' });
        })
    );
    const context = contextFor(PermissionLevel.VIEWER);

    const first = executor.execute(context);
    const second = await executor.execute(context);
    finishFirst();

    expect(errorCodeOf(second)).toBe('COMMAND_ON_COOLDOWN');
    expect((await first).success).toBe(true);
    expect(command.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the cooldown when the command crashes, so retrying a failing API call is throttled too', async () => {
    vi.mocked(command.execute).mockRejectedValueOnce(new Error('Helix timed out'));
    const context = contextFor(PermissionLevel.VIEWER);

    await executor.execute(context);
    const retry = await executor.execute(context);

    expect(errorCodeOf(retry)).toBe('COMMAND_ON_COOLDOWN');
  });

  it('records why a crashed command failed, without telling chat', async () => {
    vi.mocked(command.execute).mockRejectedValueOnce(new Error('Helix timed out'));

    const result = await executor.execute(contextFor(PermissionLevel.VIEWER));

    expect(result.message).toBe('Command execution failed');
    expect(eventBus.emit).toHaveBeenLastCalledWith(
      'command.executed',
      expect.objectContaining({ errorCode: 'EXECUTION_ERROR', reason: 'Helix timed out' })
    );
  });

  describe('a command that names what chat hears when it fails', () => {
    beforeEach(() => {
      command = { ...command, failureMessage: 'Failed to read the game' };
    });

    it('reports a failed call in those words, keeping the error out of chat', async () => {
      vi.mocked(command.execute).mockRejectedValueOnce(new Error('Helix timed out'));

      const result = await executor.execute(contextFor(PermissionLevel.VIEWER));

      expect(result.message).toBe('Failed to read the game');
      expect(eventBus.emit).toHaveBeenLastCalledWith(
        'command.executed',
        expect.objectContaining({ errorCode: 'API_ERROR', reason: 'Helix timed out' })
      );
    });

    it('reports a lost authorization as that, saying how to fix it', async () => {
      vi.mocked(command.execute).mockRejectedValueOnce(
        new NotAuthenticatedError(StreamingPlatform.TWITCH, true, 'Authorization expired')
      );

      const result = await executor.execute(contextFor(PermissionLevel.VIEWER));

      expect(result).toMatchObject({
        message: 'Authorization expired',
        error: { code: 'NOT_AUTHENTICATED', reason: 'Re-authorize the platform to continue' },
      });
    });

    it('repeats a value the platform has no such thing as, which is written for the asker', async () => {
      vi.mocked(command.execute).mockRejectedValueOnce(
        new InvalidStreamInfoError('Game not found: Nope')
      );

      const result = await executor.execute(contextFor(PermissionLevel.VIEWER));

      expect(result).toMatchObject({
        message: 'Game not found: Nope',
        error: { code: 'INVALID_INPUT' },
      });
    });
  });

  it('keeps one cooldown per viewer per platform', async () => {
    const twitch = contextFor(PermissionLevel.VIEWER);
    const youtube = { ...twitch, platform: StreamingPlatform.YOUTUBE };

    await executor.execute(twitch);
    const elsewhere = await executor.execute(youtube);

    expect(elsewhere.success).toBe(true);
  });

  it("doesn't let one viewer's cooldown throttle another", async () => {
    const first = contextFor(PermissionLevel.VIEWER);
    const second = { ...first, user: { ...first.user, platformUserId: 'someone-else' } };

    await executor.execute(first);
    const result = await executor.execute(second);

    expect(result.success).toBe(true);
  });

  it('records the platform user who ran it', async () => {
    await executor.execute(contextFor(PermissionLevel.VIEWER));

    expect(eventBus.emit).toHaveBeenLastCalledWith(
      'command.executed',
      expect.objectContaining({ userId: 'user-viewer' })
    );
  });

  it('records no reason for a success', async () => {
    await executor.execute(contextFor(PermissionLevel.VIEWER));

    expect(eventBus.emit).toHaveBeenLastCalledWith(
      'command.executed',
      expect.objectContaining({ success: true })
    );
    expect(eventBus.emit).toHaveBeenLastCalledWith(
      'command.executed',
      expect.not.objectContaining({ reason: expect.anything() })
    );
  });

  it('records a cooldown rejection in the activity log', async () => {
    const context = contextFor(PermissionLevel.VIEWER);

    await executor.execute(context);
    await executor.execute(context);

    expect(eventBus.emit).toHaveBeenLastCalledWith(
      'command.executed',
      expect.objectContaining({ command: 'game', errorCode: 'COMMAND_ON_COOLDOWN' })
    );
  });

  it('exempts a moderator, so the write branch stays responsive', async () => {
    const context = contextFor(PermissionLevel.MODERATOR);

    const first = await executor.execute(context);
    const second = await executor.execute(context);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it('exempts the broadcaster too', async () => {
    const context = contextFor(PermissionLevel.BROADCASTER);

    expect((await executor.execute(context)).success).toBe(true);
    expect((await executor.execute(context)).success).toBe(true);
  });

  it('does not record a cooldown for an exempt user, so a later viewer is unaffected', async () => {
    await executor.execute(contextFor(PermissionLevel.MODERATOR));

    const viewer = await executor.execute(contextFor(PermissionLevel.VIEWER));

    expect(viewer.success).toBe(true);
  });

  it('skips cooldowns entirely for simulations', async () => {
    const context = { ...contextFor(PermissionLevel.VIEWER), isSimulation: true };

    expect((await executor.execute(context)).success).toBe(true);
    expect((await executor.execute(context)).success).toBe(true);
  });
});
