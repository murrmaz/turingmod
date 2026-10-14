import 'reflect-metadata';
import {
  type CommandErrorCode,
  type ExecutionResult,
  type ExecutorErrorCode,
  PermissionLevel,
  StreamingPlatform,
} from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CommandExecutor } from '../commands/CommandExecutor.js';
import { checkPermission } from '../commands/utils/permissionChecks.js';
import { EventBus } from '../core/EventBus.js';
import type { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { chatMessage } from '../platforms/testing.js';
import type { Logger } from '../utils/Logger.js';
import { ChatRouter } from './ChatRouter.js';
import type { ChatModerator, ModerationVerdict } from './moderation/ChatModerator.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

function setup(
  verdict: ModerationVerdict = 'allowed',
  result: ExecutionResult = { success: true, message: 'Bonked!' }
) {
  const logger = makeLogger();
  const eventBus = new EventBus(logger);
  const executor = {
    execute: vi.fn(() => Promise.resolve(result)),
  };
  const twitch = { sendChatMessage: vi.fn(() => Promise.resolve()) };
  const moderator = { review: vi.fn(() => Promise.resolve(verdict)) };
  const router = new ChatRouter(
    eventBus,
    executor as unknown as CommandExecutor,
    { get: () => twitch } as unknown as PlatformRegistry,
    moderator as unknown as ChatModerator,
    logger
  );
  router.start();
  return { eventBus, executor, twitch, moderator, logger };
}

describe('ChatRouter', () => {
  it('runs a command from chat and posts the reply where it came from', async () => {
    const { eventBus, executor, twitch } = setup();

    await eventBus.emit('chat.message', chatMessage('!bonk someone', { badges: ['vip'] }));
    await vi.waitFor(() => expect(twitch.sendChatMessage).toHaveBeenCalledWith('Bonked!'));

    expect(executor.execute).toHaveBeenCalledWith({
      user: {
        id: 'viewer-id',
        platform: StreamingPlatform.TWITCH,
        platformUserId: 'viewer-id',
        username: 'Viewer',
        permissionLevel: PermissionLevel.VIEWER,
      },
      command: 'bonk',
      args: ['someone'],
      argText: 'someone',
      platform: StreamingPlatform.TWITCH,
      isSimulation: false,
    });
  });

  it('runs a capitalised command, as phone keyboards type it', async () => {
    const { eventBus, executor } = setup();

    await eventBus.emit('chat.message', chatMessage('!Bonk'));
    await vi.waitFor(() =>
      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'bonk' }))
    );
  });

  it('screens ordinary chat but executes nothing for it', async () => {
    const { eventBus, executor, moderator } = setup();

    await eventBus.emit('chat.message', chatMessage('just chatting'));
    await vi.waitFor(() => expect(moderator.review).toHaveBeenCalled());

    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('never runs a command the moderator blocked', async () => {
    const { eventBus, executor, moderator } = setup('blocked');

    await eventBus.emit('chat.message', chatMessage('!title banned-word stream'));
    await vi.waitFor(() => expect(moderator.review).toHaveBeenCalled());

    expect(executor.execute).not.toHaveBeenCalled();
  });

  const failure = (
    code: CommandErrorCode | ExecutorErrorCode,
    message: string
  ): ExecutionResult => ({
    success: false,
    message,
    error: { code, message },
  });

  it('stays silent in chat for an unrecognized command, logging it at debug', async () => {
    const { eventBus, executor, twitch, logger } = setup(
      'allowed',
      failure('COMMAND_NOT_FOUND', 'Unknown command: sr')
    );

    await eventBus.emit('chat.message', chatMessage('!sr some song'));
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalled());

    expect(twitch.sendChatMessage).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('sr'));
  });

  it.each(['INSUFFICIENT_PERMISSIONS', 'COMMAND_ON_COOLDOWN', 'EXECUTION_ERROR'] as const)(
    'stays silent in chat for %s',
    async (code) => {
      const { eventBus, executor, twitch } = setup('allowed', failure(code, 'Nope'));

      await eventBus.emit('chat.message', chatMessage('!delvod'));
      await vi.waitFor(() => expect(executor.execute).toHaveBeenCalled());

      expect(twitch.sendChatMessage).not.toHaveBeenCalled();
    }
  );

  it('still replies with a failure the command reported itself', async () => {
    const { eventBus, twitch } = setup('allowed', failure('INVALID_INPUT', 'Usage: !so <channel>'));

    await eventBus.emit('chat.message', chatMessage('!so'));

    await vi.waitFor(() =>
      expect(twitch.sendChatMessage).toHaveBeenCalledWith('Usage: !so <channel>')
    );
  });

  it('replies when a command refuses a viewer one of its moderator-only actions', async () => {
    const refusal = checkPermission(
      PermissionLevel.VIEWER,
      PermissionLevel.MODERATOR,
      'change the game'
    );
    if (!refusal) throw new Error('expected a refusal');
    const { eventBus, twitch } = setup('allowed', refusal);

    await eventBus.emit('chat.message', chatMessage('!game Minecraft'));

    await vi.waitFor(() =>
      expect(twitch.sendChatMessage).toHaveBeenCalledWith('Only moderators can change the game')
    );
  });
});
