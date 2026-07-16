import type {
  ErrorPayload,
  IWebSocketMessage,
  OAuthAuthUrlResponsePayload,
  OAuthExchangeCodePayload,
  OAuthExchangeResultPayload,
  OAuthGetAuthUrlPayload,
} from '@turingmod/shared';
import {
  createErrorMessage,
  createOAuthAuthUrlResponseMessage,
  createOAuthExchangeResultMessage,
} from '@turingmod/shared';
import type { IntegrationManager } from '../../integrations/IntegrationManager.js';
import { OAuthNotConfiguredError } from '../../integrations/errors.js';
import type { Logger } from '../../utils/Logger.js';

/**
 * OAuth message handler
 * Translates OAuth WebSocket messages into IntegrationManager calls. Adding
 * a new OAuth-capable provider requires no changes here — only implementing
 * IOAuthIntegration.
 */
export class OAuthHandler {
  private logger: Logger;

  constructor(
    private integrationManager: IntegrationManager,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'OAuthHandler' });
  }

  /**
   * Handle get authorization URL request
   */
  async handleGetAuthUrl(
    message: IWebSocketMessage<OAuthGetAuthUrlPayload>
  ): Promise<IWebSocketMessage<OAuthAuthUrlResponsePayload | ErrorPayload>> {
    const { integrationName } = message.payload;

    this.logger.info(`Getting auth URL for: ${integrationName}`);

    try {
      const authUrl = await this.integrationManager.getOAuthAuthorizationUrl(integrationName);

      return createOAuthAuthUrlResponseMessage(integrationName, authUrl, message.id);
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) {
        // Expected on first run — the frontend catches this and shows the
        // Setup modal, so it's not a failure. Handle the response here
        // (rather than re-throwing) so MessageRouter's catch-all doesn't
        // also log it as an error.
        this.logger.warn(`Auth URL requested for unconfigured integration: ${integrationName}`);
        return createErrorMessage('OAUTH_NOT_CONFIGURED', error.message, message.id);
      }

      this.logger.error(`Failed to get auth URL for ${integrationName}`, error);

      // Re-throw the error so the WebSocket layer handles it
      throw error;
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
      await this.integrationManager.completeOAuthExchange(integrationName, code);

      this.logger.info(`Successfully exchanged code and started: ${integrationName}`);

      return createOAuthExchangeResultMessage(integrationName, true, undefined, message.id);
    } catch (error) {
      this.logger.error(`Failed to exchange code for ${integrationName}`, error);

      return createOAuthExchangeResultMessage(
        integrationName,
        false,
        error instanceof Error ? error.message : 'Unknown error',
        message.id
      );
    }
  }
}
