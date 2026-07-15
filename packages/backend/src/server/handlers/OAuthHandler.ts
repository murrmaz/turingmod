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
} from '@turingmod/shared';
import type { IntegrationStateRepository } from '../../database/repositories/IntegrationStateRepository.js';
import type { IntegrationManager } from '../../integrations/IntegrationManager.js';
import type { IOAuthIntegration } from '../../integrations/interfaces/IOAuthIntegration.js';
import { isOAuthIntegration } from '../../integrations/interfaces/IOAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';

/**
 * OAuth message handler
 * Drives the OAuth authorization-code flow for any integration that
 * implements IOAuthIntegration. Adding a new OAuth-capable provider
 * requires no changes here — only implementing the interface.
 */
export class OAuthHandler {
  private logger: Logger;

  constructor(
    private integrationManager: IntegrationManager,
    private stateRepository: IntegrationStateRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'OAuthHandler' });
  }

  /**
   * Handle get authorization URL request
   */
  async handleGetAuthUrl(
    message: IWebSocketMessage<OAuthGetAuthUrlPayload>
  ): Promise<IWebSocketMessage<OAuthAuthUrlResponsePayload>> {
    const { integrationName } = message.payload;

    this.logger.info(`Getting auth URL for: ${integrationName}`);

    try {
      const integration = this.getOAuthIntegration(integrationName);
      const config = await this.resolveConfig(integration, integrationName);
      const authUrl = integration.getAuthorizationUrl(config);

      return createOAuthAuthUrlResponseMessage(integrationName, authUrl, message.id);
    } catch (error) {
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
      const integration = this.getOAuthIntegration(integrationName);

      await integration.exchangeCode(code);

      // Mark integration as enabled now that we have tokens, then start it
      await this.stateRepository.updateEnabled(integrationName, true);
      await this.integrationManager.startIntegration(integrationName);

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

  /**
   * Look up an integration and confirm it supports the OAuth flow
   */
  private getOAuthIntegration(integrationName: string): IOAuthIntegration {
    const integration = this.integrationManager.getIntegration(integrationName);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationName}`);
    }

    if (!isOAuthIntegration(integration)) {
      throw new Error(`Integration does not support OAuth: ${integrationName}`);
    }

    return integration;
  }

  /**
   * Resolve the config needed to build an authorization URL: prefer
   * previously-saved (database) credentials, falling back to environment
   * variables for first-time setup. Required scopes always come from the
   * integration itself, never the caller.
   */
  private async resolveConfig(
    integration: IOAuthIntegration,
    integrationName: string
  ): Promise<Record<string, unknown>> {
    try {
      const decryptedConfig = await this.stateRepository.getDecryptedConfig(integrationName);
      if (decryptedConfig?.clientId && decryptedConfig.clientSecret) {
        this.logger.info(`Loaded ${integrationName} credentials from database`);
        return { ...decryptedConfig, scopes: integration.getRequiredScopes() };
      }
    } catch (error) {
      this.logger.warn(`Could not load ${integrationName} config from database`, error);
    }

    this.logger.info(`Falling back to environment variables for ${integrationName}`);
    return integration.getEnvConfig();
  }
}
