import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAN_DURATION_MS, banCutoff } from '../../chat/moderation/bannedWords.js';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { BannedWordRepository } from '../../database/repositories/BannedWordRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { RewardRedemption } from '../interfaces/IRewardHandler.js';
import BanAWordReward from './BanAWordReward.js';

const redemption = (input: string): RewardRedemption => ({
  id: 'redemption',
  rewardId: 'reward',
  rewardTitle: 'Ban A Word',
  rewardCost: 100000,
  userId: 'viewer-id',
  userName: 'viewer',
  userDisplayName: 'Viewer',
  input,
  status: 'unfulfilled',
  redeemedAt: new Date(0),
});

describe('BanAWordReward', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let bannedWords: BannedWordRepository;
  let sendChatMessage: ReturnType<typeof vi.fn>;
  let reward: BanAWordReward;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    bannedWords = new BannedWordRepository(db);
    sendChatMessage = vi.fn(() => Promise.resolve());
    reward = new BanAWordReward(
      bannedWords,
      { sendChatMessage } as unknown as StreamControlService,
      new Logger({ level: 'silent' })
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('bans the word for a month and says so in chat', async () => {
    await reward.handle(redemption('Cheese!'));

    expect(await bannedWords.isActive('cheese', banCutoff())).toBe(true);
    expect((await bannedWords.list())[0]?.bannedBy).toBe('viewer');
    expect(sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      '@Viewer has banned the word "cheese" for a month!'
    );
  });

  it('refuses, and so refunds, anything but one word', async () => {
    await expect(reward.handle(redemption('two words'))).rejects.toThrow('Not a single word');

    expect(await bannedWords.list()).toEqual([]);
    expect(sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      '@Viewer: only one word can be banned! Your points have been refunded.'
    );
  });

  it('refuses a word that is already banned', async () => {
    await bannedWords.ban('cheese', 'someone else');

    await expect(reward.handle(redemption('cheese'))).rejects.toThrow('Already banned');
    expect((await bannedWords.list())[0]?.bannedBy).toBe('someone else');
  });

  it('renews a ban that has lapsed', async () => {
    await bannedWords.ban('cheese', 'long ago', Date.now() - BAN_DURATION_MS - 1000);

    await reward.handle(redemption('cheese'));

    expect(await bannedWords.isActive('cheese', banCutoff())).toBe(true);
    expect((await bannedWords.list())[0]?.bannedBy).toBe('viewer');
  });

  it('keeps the ban even if the chat reply fails', async () => {
    sendChatMessage.mockRejectedValue(new Error('chat down'));

    await expect(reward.handle(redemption('cheese'))).resolves.toBeUndefined();
    expect(await bannedWords.isActive('cheese', banCutoff())).toBe(true);
  });
});
