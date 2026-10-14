import type { EmptyPayload, IWebSocketMessage } from '@turingmod/shared';
import { createYouTubeChatStateMessage } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { Logger } from '../../utils/Logger.js';

/**
 * YouTube message handler
 *
 * Drives the YouTube chat integration's go-live control. YouTube offers no push notification for
 * "a broadcast started" that reaches a localhost-only server, so the console needs a way to say
 * "I'm live, go find the chat" (and the reverse).
 */
@injectable()
@singleton()
export class YouTubeHandler {
  private logger: Logger;

  constructor(
    private chatIntegration: YouTubeChatIntegration,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'YouTubeHandler' });
  }

  /**
   * Handle a go-live request: start looking for an active broadcast and connect its chat.
   */
  handleGoLive(message: IWebSocketMessage<EmptyPayload>): Promise<IWebSocketMessage | null> {
    this.logger.info('Go-live requested from the console');
    this.chatIntegration.connectChat('console');

    return Promise.resolve(
      createYouTubeChatStateMessage(this.chatIntegration.getState(), message.id)
    );
  }

  /**
   * Handle a go-offline request: disconnect from chat and return to idle.
   */
  handleGoOffline(message: IWebSocketMessage<EmptyPayload>): Promise<IWebSocketMessage | null> {
    this.logger.info('Go-offline requested from the console');
    this.chatIntegration.disconnectChat('console');

    return Promise.resolve(
      createYouTubeChatStateMessage(this.chatIntegration.getState(), message.id)
    );
  }

  /**
   * Report the current chat state. State changes are pushed as they happen, so a console that has
   * been open all along stays current on its own — but one that just loaded (or reconnected) has
   * missed every transition, and needs to ask.
   */
  handleGetState(message: IWebSocketMessage<EmptyPayload>): Promise<IWebSocketMessage | null> {
    return Promise.resolve(
      createYouTubeChatStateMessage(this.chatIntegration.getState(), message.id)
    );
  }
}
