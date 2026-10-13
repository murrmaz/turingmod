import { StreamingPlatform } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { banCutoff, normalizeBannedWord } from '../../chat/moderation/bannedWords.js';
import { BannedWordRepository } from '../../database/repositories/BannedWordRepository.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type {
  IRewardHandler,
  RewardDefinition,
  RewardRedemption,
} from '../interfaces/IRewardHandler.js';

/**
 * Bans the one word the viewer typed from chat for a month; ChatModerator enforces it. Anything
 * but exactly one word, or a word that's already banned, is refused and refunded.
 */
@injectable()
export default class BanAWordReward implements IRewardHandler {
  readonly rewardTitle = 'Ban A Word';
  readonly reward: RewardDefinition = {
    cost: 100000,
    prompt: 'Bans a SINGLE word for a single month',
    userInputRequired: true,
  };

  private logger: Logger;

  constructor(
    private bannedWords: BannedWordRepository,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'BanAWordReward' });
  }

  async handle(redemption: RewardRedemption): Promise<void> {
    const user = redemption.userDisplayName;
    const word = normalizeBannedWord(redemption.input);
    if (!word) {
      await this.reply(`@${user}: only one word can be banned! Your points have been refunded.`);
      throw new Error(`Not a single word: "${redemption.input}"`);
    }
    if (await this.bannedWords.isActive(word, banCutoff())) {
      await this.reply(`@${user}: "${word}" is already banned! Your points have been refunded.`);
      throw new Error(`Already banned: "${word}"`);
    }

    await this.bannedWords.ban(word, redemption.userName);
    await this.reply(`@${user} has banned the word "${word}" for a month!`);
  }

  /** Best-effort: a reply that fails to post mustn't undo (or refund) the ban itself. */
  private async reply(message: string): Promise<void> {
    try {
      await this.streamControl.sendChatMessage(StreamingPlatform.TWITCH, message);
    } catch (error) {
      this.logger.warn('Could not reply in chat', error);
    }
  }
}
