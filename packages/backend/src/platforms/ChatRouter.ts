import type { CommandContext, Platform } from '@turingmod/shared';
import type { CommandExecutor } from '../commands/CommandExecutor.js';
import type { EventBus } from '../core/EventBus.js';
import type { Logger } from '../utils/Logger.js';
import type { PlatformRegistry } from './PlatformRegistry.js';

/**
 * Shape of a `chat.command` EventBus event. Emitted identically by every platform's chat
 * integration (Twitch EventSub, YouTube polling) so this router never branches on platform.
 */
interface ChatCommandEvent {
  command: string;
  args: string[];
  user: CommandContext['user'];
  platform: Platform;
  metadata: Record<string, unknown>;
}

/**
 * Reply-routing seam for the live chat → command → reply loop.
 *
 * Executes an incoming `chat.command` and posts the result back to the platform the command
 * originated on.
 */
export class ChatRouter {
  private readonly liveLoopEnabled = true;

  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private commandExecutor: CommandExecutor,
    private platformRegistry: PlatformRegistry,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ChatRouter' });
  }

  /** Subscribe to `chat.command` and route replies, unless the live loop is disabled. */
  start(): void {
    if (!this.liveLoopEnabled) {
      this.logger.info('ChatRouter live loop disabled (Phase 5 deferred)');
      return;
    }

    this.eventBus.on('chat.command', (event) => {
      void this.handleChatCommand(event as ChatCommandEvent);
    });
    this.logger.info('ChatRouter live loop enabled');
  }

  /** Execute a chat command and post its reply back to the origin platform's chat. */
  private async handleChatCommand(event: ChatCommandEvent): Promise<void> {
    const context: CommandContext = {
      user: event.user,
      args: event.args,
      platform: event.platform,
      metadata: event.metadata,
      isSimulation: false,
    };

    const result = await this.commandExecutor.execute(context);

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
        command: event.command,
      });
    }
  }
}
