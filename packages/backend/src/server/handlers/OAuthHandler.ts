import type {
  IWebSocketMessage,
  OAuthAuthUrlResponsePayload,
  OAuthGetAuthUrlPayload,
} from '@turingmod/shared';
import { createOAuthAuthUrlResponseMessage } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { OAuthFlowService } from '../../integrations/OAuthFlowService.js';
import { Logger } from '../../utils/Logger.js';

/**
 * OAuth message handler
 * Hands out authorization URLs. The rest of the flow happens at the provider's redirect to the
 * backend (OAuthFlowService.handleCallback), not over the WebSocket. Adding a new OAuth-capable
 * provider requires no changes here — only implementing IOAuthIntegration.
 */
@singleton()
export class OAuthHandler {
  private logger: Logger;

  constructor(
    private oauthFlow: OAuthFlowService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'OAuthHandler' });
  }

  /**
   * Handle get authorization URL request. `consoleOrigin` is the asking console's, which the
   * callback page sends the streamer back to.
   */
  handleGetAuthUrl(
    message: IWebSocketMessage<OAuthGetAuthUrlPayload>,
    consoleOrigin: string | null
  ): Promise<IWebSocketMessage<OAuthAuthUrlResponsePayload>> {
    const { integrationName } = message.payload;

    this.logger.info(`Getting auth URL for: ${integrationName}`);

    try {
      const authUrl = this.oauthFlow.getAuthorizationUrl(integrationName, consoleOrigin);

      return Promise.resolve(
        createOAuthAuthUrlResponseMessage(integrationName, authUrl, message.id)
      );
    } catch (error) {
      this.logger.error(`Failed to get auth URL for ${integrationName}`, error);

      // Reject so the WebSocket layer reports the error to the client
      return Promise.reject(error);
    }
  }
}
