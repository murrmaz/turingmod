import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import type { ChatMessageEvent } from '../../../core/events.js';
import { type RepeatingFailures, repeatingFailures } from '../../../core/ServiceLifecycle.js';
import { BannedWordRepository } from '../../../database/repositories/BannedWordRepository.js';
import { StreamControlService } from '../../../platforms/StreamControlService.js';
import { Logger } from '../../../utils/Logger.js';
import { parseCommand } from '../../commands/parseCommand.js';
import { banCutoff, findBrokenBan, type WordBan } from './bannedWords.js';

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
  /** Moderation runs per message, so an outage would otherwise report once per message. */
  private failures: RepeatingFailures;

  constructor(
    eventBus: EventBus,
    private streamControl: StreamControlService,
    private bannedWords: BannedWordRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ChatModerator' });
    this.failures = repeatingFailures(eventBus, this.logger, 'Chat moderation');
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
      await this.act('delete', 'delete a message mentioning the streamer', () =>
        this.streamControl.require(event.platform, 'moderation').deleteChatMessage(event.messageId)
      );
      return 'blocked';
    }

    return 'allowed';
  }

  private findBannedWord(message: string): string | null {
    let banned: WordBan[];
    try {
      banned = this.bannedWords.listActive(banCutoff());
      this.failures.recovered('read');
    } catch (error) {
      this.failures.failed(
        'read',
        "Could not read the banned words, so chat isn't being checked for them.",
        error
      );
      return null;
    }
    return findBrokenBan(message, banned);
  }

  private async punishBannedWord(event: ChatMessageEvent, word: string): Promise<void> {
    this.logger.info(`${event.username} said the banned word "${word}"`);
    await this.act('reply', 'reply about a banned word', () =>
      this.streamControl.sendChatMessage(
        event.platform,
        `@${event.username}: OOPS! You said the banned word "${word}"! To the penal colony with you!`
      )
    );
    await this.act('timeout', `time out ${event.username} for a banned word`, () =>
      this.streamControl
        .require(event.platform, 'moderation')
        .timeoutUser(
          event.platformUserId,
          BANNED_WORD_TIMEOUT_SECONDS,
          'Said a chat member defined banned word'
        )
    );
  }

  private async act(kind: string, what: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.failures.recovered(kind);
    } catch (error) {
      this.failures.failed(kind, `Could not ${what}.`, error);
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
