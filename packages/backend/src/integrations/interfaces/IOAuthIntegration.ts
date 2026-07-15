import type { IIntegration } from './IIntegration.js';

/**
 * Extension of IIntegration for integrations that support the OAuth
 * authorization-code flow. Implementers own their required scopes and
 * environment-variable fallback config, so OAuthHandler can drive any
 * OAuth-capable integration without knowing which provider it is.
 */
export interface IOAuthIntegration extends IIntegration {
  /** OAuth scopes this integration requires. Single source of truth per provider. */
  getRequiredScopes(): string[];

  /**
   * Build a config from environment variables, for first-time setup before
   * any config has been saved to the database. Throws if required env vars
   * are missing.
   */
  getEnvConfig(): Record<string, unknown>;

  /** Generate the provider's authorization URL for the given config. */
  getAuthorizationUrl(config: Record<string, unknown>): string;

  /** Exchange an authorization code for tokens, persisting them. */
  exchangeCode(code: string): Promise<unknown>;

  /**
   * The HTTP path this integration's OAuth redirect URI points at, e.g.
   * '/callback/twitch'. Single source of truth — HttpServer builds its
   * callback routing table from this instead of inferring a path from the
   * integration's name.
   */
  getCallbackPath(): string;
}
