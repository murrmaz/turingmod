import { z } from 'zod';
import { OAuthConfigBaseSchema, OAuthIntegration } from './OAuthIntegration.js';

/**
 * Stored config for a provider driven through its OAuth 2.0 endpoints: the token fields as a
 * token response gives them. `expires_in` is relative, so the time it was obtained is kept with it.
 */
export const StandardOAuthConfigSchema = OAuthConfigBaseSchema.extend({
  accessToken: z.string().exactOptional(),
  refreshToken: z.string().exactOptional(),
  /** Seconds the access token was issued for. */
  expiresIn: z.number().exactOptional(),
  /** When the access token was issued, as a Unix ms timestamp. */
  obtainmentTimestamp: z.number().exactOptional(),
});

export type StandardOAuthConfig = z.infer<typeof StandardOAuthConfigSchema>;

/**
 * How a provider takes the client credentials on a token request. OAuth 2.0 allows either, but
 * each provider documents one: in the form body (Twitch), or as HTTP Basic auth (Spotify).
 */
export type ClientAuthentication = 'body' | 'basic';

/**
 * An OAuth integration whose provider is used through its OAuth 2.0 endpoints directly, rather
 * than through an SDK that builds the authorization URL and exchanges the code itself (Google's,
 * for YouTube, which extends OAuthIntegration).
 *
 * Implements the authorization-code flow from a provider's two endpoints: the authorization URL,
 * always requesting exactly the required scopes, and the code exchange, always with the same
 * redirect URI. requestToken() is there for a subclass that refreshes tokens itself. A subclass
 * declares the endpoints, how it sends client credentials, and its token response's schema, and
 * maps that response to stored config in toConfigPatch(); what it builds in connect() and how its
 * tokens are refreshed stay its own.
 */
export abstract class StandardOAuthIntegration<
  TConfig extends StandardOAuthConfig,
  TTokenResponse,
> extends OAuthIntegration<TConfig> {
  /** Where the streamer is sent to grant access. */
  protected abstract readonly authorizeUrl: string;
  /** Where codes, and refresh tokens, are exchanged for tokens. */
  protected abstract readonly tokenUrl: string;
  protected abstract readonly clientAuthentication: ClientAuthentication;
  /** What a token response must hold. Not strict: the provider may add fields. */
  protected abstract readonly tokenResponseSchema: z.ZodType<TTokenResponse>;

  /** The stored-config fields for a token response. */
  protected abstract toConfigPatch(response: TTokenResponse): Partial<TConfig>;

  protected hasTokens(config: TConfig): boolean {
    return Boolean(config.accessToken);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.requireConfig().clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: this.requiredScopes.join(' '),
      state,
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<void> {
    this.logger.info('Exchanging authorization code for tokens');

    const response = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(),
    });
    if (!response.ok) {
      throw new Error(`Failed to exchange code: ${await response.text()}`);
    }
    this.saveTokens(
      this.toConfigPatch(await this.parseTokenResponse(this.tokenResponseSchema, response))
    );

    this.logger.info('Successfully exchanged code for tokens');
  }

  /** POST to the token endpoint, with the client credentials where the provider takes them. */
  protected requestToken(params: Record<string, string>): Promise<Response> {
    const { clientId, clientSecret } = this.requireConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const body = new URLSearchParams(params);
    if (this.clientAuthentication === 'basic') {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    } else {
      body.set('client_id', clientId);
      body.set('client_secret', clientSecret);
    }
    return fetch(this.tokenUrl, { method: 'POST', headers, body });
  }
}
