import type { CommandContext } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { CommandExecutor, EXECUTOR_ERROR_CODES } from '../commands/CommandExecutor.js';
import { EventBus } from '../core/EventBus.js';
import { ChatModerator } from '../moderation/ChatModerator.js';
import { Logger } from '../utils/Logger.js';
import { type ChatMessageEvent, parseCommand } from './chatMessage.js';
import { PlatformRegistry } from './PlatformRegistry.js';

/**
 * The live chat → moderation → command → reply loop.
 *
 * Every `chat.message` (emitted the same way by each platform's chat integration, so this never
 * branches on platform) is first screened by ChatModerator. A message it blocks goes no further,
 * so a command can't slip a banned word past it. Otherwise a `!command` is executed and its reply
 * posted back to the platform it came from.
 */
@injectable()
@singleton()
export class ChatRouter {
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private commandExecutor: CommandExecutor,
    private platformRegistry: PlatformRegistry,
    private moderator: ChatModerator,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ChatRouter' });
  }

  /** Subscribe to `chat.message` and route replies. */
  start(): void {
    this.eventBus.on<ChatMessageEvent>('chat.message', (event) => {
      void this.handleChatMessage(event);
    });
    this.logger.info('ChatRouter live loop enabled');
  }

  /** Screen a message, then execute it if it's a command and post the reply. */
  async handleChatMessage(event: ChatMessageEvent): Promise<void> {
    if ((await this.moderator.review(event)) === 'blocked') {
      return;
    }

    const parsed = parseCommand(event.message);
    if (!parsed) {
      return;
    }

    const context: CommandContext = {
      user: {
        id: event.platformUserId,
        platform: event.platform,
        platformUserId: event.platformUserId,
        username: event.username,
        permissionLevel: event.permissionLevel,
      },
      args: parsed.args,
      platform: event.platform,
      metadata: { badges: event.badges, channelId: event.channelId },
      isSimulation: false,
    };

    const result = await this.commandExecutor.execute(context);

    // Failures CommandExecutor produced itself get no reply in chat: an unknown `!word` is often
    // meant for another bot, and permission and cooldown rejections are in the activity log.
    // Failures a command reported (usage, "game not found") still reach the viewer.
    const errorCode = result.error?.code;
    if (errorCode !== undefined && EXECUTOR_ERROR_CODES.has(errorCode)) {
      if (errorCode === 'COMMAND_NOT_FOUND') {
        this.logger.debug(`Unrecognized command from ${event.username}: ${parsed.command}`);
      }
      return;
    }

    // A command can deliberately reply with nothing, e.g. when it announces its outcome to
    // every platform itself.
    if (result.message.trim() === '') {
      return;
    }

    const platform = this.platformRegistry.get(event.platform);
    if (!platform) {
      this.logger.warn(`No platform registered for reply routing: ${event.platform}`);
      return;
    }

    try {
      await platform.sendChatMessage(result.message);
    } catch (error) {
      this.logger.error('Failed to send command reply to chat', error, {
        platform: event.platform,
        command: parsed.command,
      });
    }
  }
}
