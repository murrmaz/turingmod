import type {
  IWebSocketMessage,
  OAuthAuthUrlResponsePayload,
  OAuthExchangeCodePayload,
  OAuthExchangeResultPayload,
  OAuthGetAuthUrlPayload,
} from '@turingmod/shared';
import {
  createOAuthAuthUrlResponseMessage,
  createOAuthExchangeResultMessage,
  messageOf,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { OAuthFlowService } from '../../integrations/OAuthFlowService.js';
import { Logger } from '../../utils/Logger.js';

/**
 * OAuth message handler
 * Translates OAuth WebSocket messages into OAuthFlowService calls. Adding
 * a new OAuth-capable provider requires no changes here — only implementing
 * IOAuthIntegration.
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
   * Handle get authorization URL request
   */
  handleGetAuthUrl(
    message: IWebSocketMessage<OAuthGetAuthUrlPayload>,
    clientId: string
  ): Promise<IWebSocketMessage<OAuthAuthUrlResponsePayload>> {
    const { integrationName } = message.payload;

    this.logger.info(`Getting auth URL for: ${integrationName}`);

    try {
      const authUrl = this.oauthFlow.getAuthorizationUrl(integrationName, clientId);

      return Promise.resolve(
        createOAuthAuthUrlResponseMessage(integrationName, authUrl, message.id)
      );
    } catch (error) {
      this.logger.error(`Failed to get auth URL for ${integrationName}`, error);

      // Reject so the WebSocket layer reports the error to the client
      return Promise.reject(error);
    }
  }

  /**
   * Handle exchange authorization code
   */
  async handleExchangeCode(
    message: IWebSocketMessage<OAuthExchangeCodePayload>
  ): Promise<IWebSocketMessage<OAuthExchangeResultPayload>> {
    const { integrationName, code } = message.payload;

    this.logger.info(`Exchanging code for: ${integrationName}`);

    try {
      await this.oauthFlow.completeExchange(integrationName, code);

      this.logger.info(`Successfully exchanged code and started: ${integrationName}`);

      return createOAuthExchangeResultMessage(integrationName, true, undefined, message.id);
    } catch (error) {
      this.logger.error(`Failed to exchange code for ${integrationName}`, error);

      return createOAuthExchangeResultMessage(integrationName, false, messageOf(error), message.id);
    }
  }
}
