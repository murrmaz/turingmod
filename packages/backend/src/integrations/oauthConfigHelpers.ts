import { OAuthNotConfiguredError } from './errors.js';

/**
 * Config shape shared by every OAuth-capable integration, extended with
 * provider-specific token fields (e.g. accessToken, expiresIn vs expiryDate).
 */
export interface OAuthConfigBase {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
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
 * Build a config from environment variables, for first-time setup before any
 * config has been saved to the database. Throws OAuthNotConfiguredError if
 * credentials aren't set — callers (e.g. the setup UI) catch this to decide
 * whether to prompt for manual entry.
 */
export function buildOAuthEnvConfig<T extends OAuthConfigBase>(params: {
  providerLabel: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  redirectUri: string;
  scopes: string[];
}): T {
  const config = {
    clientId: process.env[params.clientIdEnvVar] || '',
    clientSecret: process.env[params.clientSecretEnvVar] || '',
    redirectUri: params.redirectUri,
    scopes: params.scopes,
  } as T;

  if (!(config.clientId && config.clientSecret)) {
    throw new OAuthNotConfiguredError(
      `${params.providerLabel} credentials not configured. Please configure Client ID and Client Secret.`
    );
  }

  return config;
}
