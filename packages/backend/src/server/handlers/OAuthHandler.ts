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
import type { SpotifyAuthConfig } from '../../integrations/implementations/SpotifyAuthIntegration.js';
import type { TwitchAuthConfig } from '../../integrations/implementations/TwitchAuthIntegration.js';
import type { Logger } from '../../utils/Logger.js';

/**
 * Integrations that support OAuth authorization flow.
 */
const OAUTH_INTEGRATIONS = ['twitch-auth', 'spotify-auth'];

/**
 * Required OAuth scopes for Twitch integrations.
 * Single source of truth — the frontend should not specify scopes.
 */
const TWITCH_REQUIRED_SCOPES = [
  'chat:read',
  'chat:edit',
  'user:read:chat',
  'user:write:chat',
  'channel:read:subscriptions',
  'moderator:read:followers',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:warnings',
  'user:read:email',
];

/**
 * Required OAuth scopes for Spotify integrations.
 * Single source of truth — the frontend should not specify scopes.
 */
const SPOTIFY_REQUIRED_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
];

/**
 * OAuth message handler
 * Handles OAuth authorization flow for integrations
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
      if (!OAUTH_INTEGRATIONS.includes(integrationName)) {
        throw new Error(`OAuth not supported for integration: ${integrationName}`);
      }

      // Get the integration
      const integration = this.integrationManager.getIntegration(integrationName);
      if (!integration) {
        throw new Error(`Integration not found: ${integrationName}`);
      }

      // Type guard: integration must support getAuthorizationUrl
      if (!('getAuthorizationUrl' in integration)) {
        throw new Error(`Integration does not support OAuth: ${integrationName}`);
      }

      // Get the auth URL (this requires the integration to be initialized with config)
      const config = await this.getIntegrationConfig(integrationName);
      const authUrl = (
        integration as unknown as { getAuthorizationUrl(config: Record<string, unknown>): string }
      ).getAuthorizationUrl(config as unknown as Record<string, unknown>);

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
      if (!OAUTH_INTEGRATIONS.includes(integrationName)) {
        throw new Error(`OAuth not supported for integration: ${integrationName}`);
      }

      // Get the integration
      const integration = this.integrationManager.getIntegration(integrationName);
      if (!integration) {
        throw new Error(`Integration not found: ${integrationName}`);
      }

      // Type guard: integration must support exchangeCode
      if (!('exchangeCode' in integration)) {
        throw new Error(`Integration does not support OAuth: ${integrationName}`);
      }

      const oauthIntegration = integration as unknown as {
        exchangeCode(code: string): Promise<unknown>;
      };

      // Exchange the code for tokens
      await oauthIntegration.exchangeCode(code);

      // Mark integration as enabled now that we have tokens
      const state = await this.stateRepository.findByName(integrationName);
      if (state) {
        await this.stateRepository.updateEnabled(integrationName, true);
      }

      // Start the integration now that we have tokens
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
   * Get integration config from database or environment variables
   */
  private async getIntegrationConfig(
    integrationName: string
  ): Promise<TwitchAuthConfig | SpotifyAuthConfig> {
    // First, try to load from database
    try {
      const state = await this.stateRepository.findByName(integrationName);
      if (state?.config) {
        const decryptedConfig = await this.stateRepository.getDecryptedConfig(integrationName);
        if (decryptedConfig?.clientId && decryptedConfig.clientSecret) {
          this.logger.info(`Loaded ${integrationName} credentials from database`);

          const scopes =
            integrationName === 'spotify-auth' ? SPOTIFY_REQUIRED_SCOPES : TWITCH_REQUIRED_SCOPES;

          return {
            ...decryptedConfig,
            scopes,
          } as TwitchAuthConfig | SpotifyAuthConfig;
        }
      }
    } catch (error) {
      this.logger.warn(`Could not load ${integrationName} config from database`, error);
    }

    // Fallback to environment variables
    this.logger.info(`Falling back to environment variables for ${integrationName}`);

    if (integrationName === 'spotify-auth') {
      return this.getSpotifyEnvConfig();
    }

    return this.getTwitchEnvConfig();
  }

  /**
   * Get Twitch config from environment variables
   */
  private getTwitchEnvConfig(): TwitchAuthConfig {
    const config = {
      clientId: process.env.TWITCH_CLIENT_ID || '',
      clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
      redirectUri: 'http://localhost:8080/callback/twitch',
      scopes: TWITCH_REQUIRED_SCOPES,
    };

    if (!(config.clientId && config.clientSecret)) {
      throw new Error(
        'Twitch credentials not configured. Please configure Client ID and Client Secret.'
      );
    }

    return config;
  }

  /**
   * Get Spotify config from environment variables
   */
  private getSpotifyEnvConfig(): SpotifyAuthConfig {
    const config = {
      clientId: process.env.SPOTIFY_CLIENT_ID || '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
      redirectUri: 'http://127.0.0.1:8080/callback/spotify',
      scopes: SPOTIFY_REQUIRED_SCOPES,
    };

    if (!(config.clientId && config.clientSecret)) {
      throw new Error(
        'Spotify credentials not configured. Please configure Client ID and Client Secret.'
      );
    }

    return config;
  }
}
