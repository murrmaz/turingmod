import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';

/**
 * Config shape shared by every OAuth-capable integration, extended with
 * provider-specific token fields (e.g. accessToken, expiresIn vs expiryDate).
 *
 * There is deliberately no redirect URI here: it follows from the server's
 * port, so it's derived (oauthRedirectUri) rather than stored. Configs saved
 * before that may still carry a `redirectUri` field, which nothing reads.
 */
export interface OAuthConfigBase {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

/**
 * The loopback host a provider accepts plain-HTTP redirects to. Each accepts
 * only one: Twitch requires `localhost`, while Spotify and Google require the
 * literal `127.0.0.1`.
 */
export type LoopbackHost = 'localhost' | '127.0.0.1';

/**
 * The redirect URI an OAuth provider sends the browser back to: this server's
 * callback route, on the host the provider allows. It has to match what the
 * user registered with the provider, so changing SERVER_PORT means updating
 * that registration too.
 */
export function oauthRedirectUri(host: LoopbackHost, port: number, callbackPath: string): string {
  return `http://${host}:${port}${callbackPath}`;
}

/**
 * Validate clientId/clientSecret are present and default scopes to
 * `requiredScopes` when the caller (e.g. the setup UI) intentionally omits
 * them — mutates `config` in place. Each integration is the single source of
 * truth for its own scopes, so getAuthorizationUrl() should never see an
 * undefined/empty scopes array.
 */
export function validateOAuthConfig<T extends OAuthConfigBase>(
  config: T,
  requiredScopes: string[]
): void {
  if (!(config.clientId && config.clientSecret)) {
    throw new Error('Missing clientId or clientSecret in configuration');
  }

  if (!config.scopes || config.scopes.length === 0) {
    config.scopes = requiredScopes;
  }
}

/**
 * Merge a token patch into an OAuth integration's in-memory config and
 * persist the result (encrypted) to `IntegrationStateRepository`. Returns the
 * merged config so the caller can update its own `this.config` reference.
 */
export async function persistOAuthTokens<T extends OAuthConfigBase>(
  stateRepo: IntegrationStateRepository,
  integrationName: string,
  currentConfig: T,
  patch: Partial<T>
): Promise<T> {
  const updatedConfig: T = { ...currentConfig, ...patch };
  await stateRepo.upsert(
    integrationName,
    updatedConfig as unknown as Record<string, unknown>,
    true
  );
  return updatedConfig;
}
