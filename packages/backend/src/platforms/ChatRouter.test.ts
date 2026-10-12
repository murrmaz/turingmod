import 'reflect-metadata';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CommandExecutor } from '../commands/CommandExecutor.js';
import { EventBus } from '../core/EventBus.js';
import type { ChatModerator, ModerationVerdict } from '../moderation/ChatModerator.js';
import type { Logger } from '../utils/Logger.js';
import { ChatRouter } from './ChatRouter.js';
import type { PlatformRegistry } from './PlatformRegistry.js';
import { chatMessage } from './testing.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

function setup(verdict: ModerationVerdict = 'allowed') {
  const logger = makeLogger();
  const eventBus = new EventBus(logger);
  const executor = {
    execute: vi.fn(() => Promise.resolve({ success: true, message: 'Bonked!' })),
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
  return { eventBus, executor, twitch, moderator };
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
      args: ['bonk', 'someone'],
      platform: StreamingPlatform.TWITCH,
      metadata: { badges: ['vip'], channelId: 'channel-id' },
      isSimulation: false,
    });
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
});
