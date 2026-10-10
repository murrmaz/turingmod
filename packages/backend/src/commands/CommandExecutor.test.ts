import type { CommandContext, CommandResult, PlatformCapability } from '@turingmod/shared';
import { PermissionLevel, Platform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../core/EventBus.js';
import type { CommandHistoryRepository } from '../database/repositories/CommandHistoryRepository.js';
import type { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import type { Logger } from '../utils/Logger.js';
import { CommandExecutor } from './CommandExecutor.js';
import type { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

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

const contextFor = (permissionLevel: PermissionLevel): CommandContext => ({
  user: {
    id: `user-${permissionLevel}`,
    platform: Platform.TWITCH,
    platformUserId: '1',
    username: 'someone',
    permissionLevel,
  },
  args: ['game'],
  platform: Platform.TWITCH,
  metadata: {},
  isSimulation: false,
});

describe('CommandExecutor cooldowns', () => {
  let command: ICommand;
  let executor: CommandExecutor;

  beforeEach(() => {
    command = dualModeCommand(30);
    const registry = { get: () => command } as unknown as CommandRegistry;
    const history = {
      create: vi.fn(() => Promise.resolve()),
    } as unknown as CommandHistoryRepository;
    const platforms = { capabilitiesFor: () => new Set() } as unknown as PlatformRegistry;
    const eventBus = {
      emit: vi.fn(),
      emitAsync: vi.fn(() => Promise.resolve()),
    } as unknown as EventBus;
    executor = new CommandExecutor(registry, history, platforms, eventBus, makeLogger());
  });

  it('throttles a viewer on the second invocation', async () => {
    const context = contextFor(PermissionLevel.VIEWER);

    const first = await executor.execute(context);
    const second = await executor.execute(context);

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('COMMAND_ON_COOLDOWN');
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
