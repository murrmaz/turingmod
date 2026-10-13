import 'reflect-metadata';
import { PermissionLevel, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { BannedWordRepository } from '../../database/repositories/BannedWordRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import { fakeRequire } from '../../platforms/fakeRequire.js';
import type { ModerationApi } from '../../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { chatMessage } from '../../platforms/testing.js';
import type { Logger } from '../../utils/Logger.js';
import { BAN_DURATION_MS } from './bannedWords.js';
import { BANNED_WORD_TIMEOUT_SECONDS, ChatModerator } from './ChatModerator.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

describe('ChatModerator', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let bannedWords: BannedWordRepository;
  let moderated: Set<StreamingPlatform>;
  let streamControl: {
    supports: (platform: StreamingPlatform, capability: PlatformCapability) => boolean;
    sendChatMessage: ReturnType<typeof vi.fn>;
    require: StreamControlService['require'];
  };
  let moderation: {
    timeoutUser: ReturnType<typeof vi.fn<ModerationApi['timeoutUser']>>;
    deleteChatMessage: ReturnType<typeof vi.fn<ModerationApi['deleteChatMessage']>>;
  };
  let moderator: ChatModerator;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    bannedWords = new BannedWordRepository(db);
    moderated = new Set([StreamingPlatform.TWITCH]);
    moderation = {
      timeoutUser: vi.fn(() => Promise.resolve()),
      deleteChatMessage: vi.fn(() => Promise.resolve()),
    };
    streamControl = {
      supports: (platform, capability) =>
        capability === PlatformCapability.MODERATION && moderated.has(platform),
      sendChatMessage: vi.fn(() => Promise.resolve()),
      require: fakeRequire(StreamingPlatform.TWITCH, { moderation }),
    };
    moderator = new ChatModerator(
      streamControl as unknown as StreamControlService,
      bannedWords,
      makeLogger()
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('times out and calls out a viewer who says a banned word, blocking the message', async () => {
    await bannedWords.ban('cheese', 'someone');

    expect(await moderator.review(chatMessage('I love CHEESE!'))).toBe('blocked');

    expect(moderation.timeoutUser).toHaveBeenCalledWith(
      'viewer-id',
      BANNED_WORD_TIMEOUT_SECONDS,
      'Said a chat member defined banned word'
    );
    expect(streamControl.sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      '@Viewer: OOPS! You said the banned word "cheese"! To the penal colony with you!'
    );
  });

  it('blocks a command containing a banned word, so it never runs', async () => {
    await bannedWords.ban('cheese', null);

    expect(await moderator.review(chatMessage('!title cheese stream'))).toBe('blocked');
  });

  it('only matches whole words', async () => {
    await bannedWords.ban('cheese', null);

    expect(await moderator.review(chatMessage('cheesecake please'))).toBe('allowed');
  });

  it('stops enforcing a ban after a month', async () => {
    await bannedWords.ban('cheese', null, Date.now() - BAN_DURATION_MS - 1000);

    expect(await moderator.review(chatMessage('cheese'))).toBe('allowed');
    expect(moderation.timeoutUser).not.toHaveBeenCalled();
  });

  it('exempts the broadcaster', async () => {
    await bannedWords.ban('cheese', null);

    expect(
      await moderator.review(
        chatMessage('cheese', { permissionLevel: PermissionLevel.BROADCASTER })
      )
    ).toBe('allowed');
  });

  it('leaves platforms it cannot moderate alone', async () => {
    await bannedWords.ban('cheese', null);

    expect(
      await moderator.review(chatMessage('cheese', { platform: StreamingPlatform.YOUTUBE }))
    ).toBe('allowed');
  });

  it('in quiet mode, deletes messages that @-mention the streamer', async () => {
    moderator.setQuietMode(true);

    expect(await moderator.review(chatMessage('hey @Pope_Pontius, hi!'))).toBe('blocked');
    expect(moderation.deleteChatMessage).toHaveBeenCalledWith('message-id');
  });

  it('lets mentions through outside quiet mode, and commands through in it', async () => {
    expect(await moderator.review(chatMessage('hey @pope_pontius'))).toBe('allowed');

    moderator.setQuietMode(true);
    expect(await moderator.review(chatMessage('!so @pope_pontius'))).toBe('allowed');
    expect(await moderator.review(chatMessage('hey @pope_pontius_fan'))).toBe('allowed');
    expect(moderation.deleteChatMessage).not.toHaveBeenCalled();
  });

  it('still blocks the message when acting on it fails', async () => {
    await bannedWords.ban('cheese', null);
    moderation.timeoutUser.mockRejectedValue(new Error('cannot time out a moderator'));

    expect(await moderator.review(chatMessage('cheese'))).toBe('blocked');
  });
});
