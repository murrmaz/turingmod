import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { parseCommand } from '../../commands/parseCommand.js';
import { BannedWordRepository } from '../../database/repositories/BannedWordRepository.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { ChatMessageEvent } from '../chatMessage.js';
import { banCutoff, wordsIn } from './bannedWords.js';

/** How long saying a banned word times a viewer out, as in the original bot. */
export const BANNED_WORD_TIMEOUT_SECONDS = 10;

export type ModerationVerdict = 'allowed' | 'blocked';

/**
 * Screens each chat message before ChatRouter acts on it.
 *
 * - **Banned words**: a message containing a word banned with "Ban A Word" in the last month gets
 *   its author timed out and a reply in chat, and any command in it doesn't run.
 * - **Quiet mode**: while on, a message (not a command) that @-mentions the streamer is deleted.
 *
 * The broadcaster is exempt from both. Only platforms with the MODERATION capability are
 * screened, since there'd be no way to act on what was found.
 */
@singleton()
export class ChatModerator {
  private quietMode = false;
  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    private bannedWords: BannedWordRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ChatModerator' });
  }

  isQuietMode(): boolean {
    return this.quietMode;
  }

  setQuietMode(enabled: boolean): void {
    this.quietMode = enabled;
    this.logger.info(`Quiet mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /** Decide on a message, acting on it if it breaks a rule. Never rejects. */
  async review(event: ChatMessageEvent): Promise<ModerationVerdict> {
    if (
      event.permissionLevel === PermissionLevel.BROADCASTER ||
      !this.streamControl.supports(event.platform, PlatformCapability.MODERATION)
    ) {
      return 'allowed';
    }

    const bannedWord = this.findBannedWord(event.message);
    if (bannedWord) {
      await this.punishBannedWord(event, bannedWord);
      return 'blocked';
    }

    if (this.quietMode && !parseCommand(event.message) && mentionsChannel(event)) {
      await this.act('delete a message mentioning the streamer', () =>
        this.streamControl.require(event.platform, 'moderation').deleteChatMessage(event.messageId)
      );
      return 'blocked';
    }

    return 'allowed';
  }

  private findBannedWord(message: string): string | null {
    let banned: string[];
    try {
      banned = this.bannedWords.listActive(banCutoff());
    } catch (error) {
      this.logger.error('Could not read banned words; letting the message through', error);
      return null;
    }
    if (banned.length === 0) return null;
    const bannedSet = new Set(banned);
    return wordsIn(message).find((word) => bannedSet.has(word)) ?? null;
  }

  private async punishBannedWord(event: ChatMessageEvent, word: string): Promise<void> {
    this.logger.info(`${event.username} said the banned word "${word}"`);
    await this.act('reply about a banned word', () =>
      this.streamControl.sendChatMessage(
        event.platform,
        `@${event.username}: OOPS! You said the banned word "${word}"! To the penal colony with you!`
      )
    );
    await this.act(`time out ${event.username}`, () =>
      this.streamControl
        .require(event.platform, 'moderation')
        .timeoutUser(
          event.platformUserId,
          BANNED_WORD_TIMEOUT_SECONDS,
          'Said a chat member defined banned word'
        )
    );
  }

  private async act(what: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.error(`Could not ${what}`, error);
    }
  }
}

/** Whether a message @-mentions the channel it was posted in. */
function mentionsChannel(event: ChatMessageEvent): boolean {
  if (!event.channelName) return false;
  const mention = `@${event.channelName.toLowerCase()}`;
  return event.message
    .toLowerCase()
    .split(/\s+/)
    .some((word) => word.replace(/[^\w@]/g, '') === mention);
}
