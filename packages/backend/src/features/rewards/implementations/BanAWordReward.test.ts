import 'reflect-metadata';
import { BAN_DURATION_MS, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import type { RewardRedemption } from '../../../core/events.js';
import type { DatabaseManager } from '../../../database/DatabaseManager.js';
import { BannedWordRepository } from '../../../database/repositories/BannedWordRepository.js';
import { createTestDatabase } from '../../../database/repositories/testDatabase.js';
import type { StreamControlService } from '../../../platforms/StreamControlService.js';
import { Logger } from '../../../utils/Logger.js';
import { BannedWordList } from '../../chat/moderation/BannedWordList.js';
import { banCutoff } from '../../chat/moderation/bannedWords.js';
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
  let eventBus: EventBus;
  let reward: BanAWordReward;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    bannedWords = new BannedWordRepository(db);
    sendChatMessage = vi.fn(() => Promise.resolve());
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    reward = new BanAWordReward(
      new BannedWordList(eventBus, bannedWords),
      { sendChatMessage } as unknown as StreamControlService,
      new Logger({ level: 'silent' })
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('bans the word for a month and says so in chat', async () => {
    await reward.handle(redemption('Cheese!'));

    expect(bannedWords.isActive('cheese', banCutoff())).toBe(true);
    expect(bannedWords.list()[0]?.bannedBy).toBe('viewer');
    expect(sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      '@Viewer has banned the word "cheese" for a month!'
    );
  });

  it('tells the console about the ban', async () => {
    const changed = vi.fn();
    eventBus.on('bannedWords.changed', changed);

    await reward.handle(redemption('cheese'));

    expect(changed).toHaveBeenCalledOnce();
  });

  it('refuses, and so refunds, anything but one word', async () => {
    await expect(reward.handle(redemption('two words'))).rejects.toThrow('Not a single word');

    expect(bannedWords.list()).toEqual([]);
    expect(sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      '@Viewer: only one word can be banned! Your points have been refunded.'
    );
  });

  it('refuses a word that is already banned', async () => {
    bannedWords.ban('cheese', 'someone else');

    await expect(reward.handle(redemption('cheese'))).rejects.toThrow('Already banned');
    expect(bannedWords.list()[0]?.bannedBy).toBe('someone else');
  });

  it('renews a ban that has lapsed', async () => {
    bannedWords.ban('cheese', 'long ago', Date.now() - BAN_DURATION_MS - 1000);

    await reward.handle(redemption('cheese'));

    expect(bannedWords.isActive('cheese', banCutoff())).toBe(true);
    expect(bannedWords.list()[0]?.bannedBy).toBe('viewer');
  });

  it('keeps the ban even if the chat reply fails', async () => {
    sendChatMessage.mockRejectedValue(new Error('chat down'));

    await expect(reward.handle(redemption('cheese'))).resolves.toBeUndefined();
    expect(bannedWords.isActive('cheese', banCutoff())).toBe(true);
  });
});
