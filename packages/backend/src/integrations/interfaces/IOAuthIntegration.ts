import type { IIntegration } from './IIntegration.js';

/**
 * Extension of IIntegration for integrations that support the OAuth
 * authorization-code flow. Implementers own their required scopes and
 * client credentials, so OAuthFlowService can drive any OAuth-capable
 * integration without knowing which provider it is.
 */
export interface IOAuthIntegration extends IIntegration {
  /**
   * Whether client credentials (id and secret) have been set up. They're
   * entered once in the console's setup dialog and stored with the rest of
   * the integration's config; there is no other source.
   */
  isConfigured(): boolean;

  /**
   * Generate the provider's authorization URL from the configured client
   * credentials, requesting the integration's required scopes. `state`
   * is an opaque, server-generated, single-use value that must be echoed
   * back unmodified by the provider on the callback — it's how the callback
   * gets correlated back to the WebSocket client that started the flow.
   */
  getAuthorizationUrl(state: string): string;

  /** Exchange an authorization code for tokens, persisting them. */
  exchangeCode(code: string): Promise<void>;

  /**
   * The HTTP path this integration's OAuth redirect URI points at, e.g.
   * '/callback/twitch'. Single source of truth — HttpServer builds its
   * callback routing table from this instead of inferring a path from the
   * integration's name.
   */
  getCallbackPath(): string;

  /**
   * The full redirect URI sent to the provider: the callback path on this
   * server's port, on the loopback host the provider accepts. Derived, never
   * stored or taken from the client, so it always matches the port the server
   * is actually listening on.
   */
  getRedirectUri(): string;
}
