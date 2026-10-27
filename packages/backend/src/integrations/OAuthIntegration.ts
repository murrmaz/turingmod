import { IntegrationStatus, messageOf, OAuthClientCredentialsSchema } from '@turingmod/shared';
import { z } from 'zod';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import type { TuringModConfig } from '../utils/Config.js';
import type { Logger } from '../utils/Logger.js';
import { BaseIntegration } from './BaseIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

/**
 * Stored config shared by every OAuth-capable integration. Each provider's schema extends it with
 * its own token fields (e.g. expiresIn vs Google's expiryDate). Requested scopes aren't stored:
 * they're always the integration's required set.
 */
export const OAuthConfigBaseSchema = OAuthClientCredentialsSchema.extend({
  /** What the provider actually granted with the current token. Absent until the first grant. */
  grantedScopes: z.array(z.string()).exactOptional(),
});

export type OAuthConfigBase = z.infer<typeof OAuthConfigBaseSchema>;

/**
 * The loopback host a provider accepts plain-HTTP redirects to. Each accepts
 * only one: Twitch requires `localhost`, while Spotify and Google require the
 * literal `127.0.0.1`.
 */
export type LoopbackHost = 'localhost' | '127.0.0.1';

/**
 * An integration that is an OAuth client: holds client credentials and tokens
 * in its stored config, and takes part in the authorization-code flow that
 * OAuthFlowService drives.
 *
 * The base owns what doesn't vary by provider — parsing the stored config, the
 * redirect URI, persisting tokens, and the checks before connecting (no token
 * yet, or a grant missing a required scope). A subclass declares its scopes,
 * callback path, redirect host and config schema, and implements what its provider or SDK
 * does differently: the authorization URL, the code exchange, building its
 * client in connect(), and refreshing tokens.
 */
export abstract class OAuthIntegration<TConfig extends OAuthConfigBase>
  extends BaseIntegration
  implements IOAuthIntegration
{
  /** The scopes this integration needs. Always what's requested, and what a grant is checked against. */
  protected abstract readonly requiredScopes: readonly string[];
  /** The HTTP path the provider redirects back to, e.g. '/callback/twitch'. */
  protected abstract readonly callbackPath: string;
  protected abstract readonly redirectHost: LoopbackHost;
  /** What this provider's stored config must look like. */
  protected abstract readonly configSchema: z.ZodType<TConfig>;

  protected config: TConfig | null = null;

  protected constructor(
    logger: Logger,
    component: string,
    private readonly stateRepo: IntegrationStateRepository,
    private readonly serverConfig: TuringModConfig
  ) {
    super(logger, { component });
  }

  override get oauth(): IOAuthIntegration {
    return this;
  }

  override initialize(stored: unknown): Promise<void> {
    this.config = this.parseConfig(this.configSchema, stored);
    return Promise.resolve();
  }

  /**
   * Connect if there's a usable grant. Without a token it stays DISCONNECTED
   * until the user authorizes. A grant from before a scope was added still
   * works for everything it covers, so nothing would fail until the first
   * call needing the new scope, far from the cause; refusing to start on it
   * shows the gap as NEEDS_REAUTH here instead.
   */
  async start(): Promise<void> {
    const config = this.requireConfig();
    this.setStatus(IntegrationStatus.CONNECTING);

    if (!this.hasTokens(config)) {
      this.logger.warn('No tokens available. User must complete OAuth flow.');
      this.setStatus(IntegrationStatus.DISCONNECTED);
      return;
    }

    const granted = config.grantedScopes ?? [];
    const missingScopes = this.requiredScopes.filter((scope) => !granted.includes(scope));
    if (missingScopes.length > 0) {
      this.logger.warn('Stored grant is missing required scopes', { missingScopes });
      this.setStatus(
        IntegrationStatus.NEEDS_REAUTH,
        `Re-authorization required for new permissions: ${missingScopes.join(', ')}`
      );
      return;
    }

    try {
      await this.connect(config);
      this.setStatus(IntegrationStatus.CONNECTED);
    } catch (error) {
      this.logger.error('Failed to connect', error);
      if (this.isReauthRequiredError(error)) {
        this.setStatus(
          IntegrationStatus.NEEDS_REAUTH,
          'Refresh token is invalid or revoked — re-authorization required'
        );
      } else {
        this.setStatus(IntegrationStatus.ERROR, messageOf(error));
      }
      throw error;
    }
  }

  stop(): Promise<void> {
    this.disconnect();
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }

  /** Whether client credentials have been saved: the schema doesn't admit a config without them. */
  isConfigured(): boolean {
    return this.config !== null;
  }

  getCallbackPath(): string {
    return this.callbackPath;
  }

  /**
   * This server's callback route, on the host the provider allows. It has to
   * match what the user registered with the provider, so changing SERVER_PORT
   * means updating that registration too.
   */
  getRedirectUri(): string {
    return `http://${this.redirectHost}:${this.serverConfig.serverPort}${this.callbackPath}`;
  }

  abstract getAuthorizationUrl(state: string): string;
  abstract exchangeCode(code: string): Promise<void>;

  /** Whether the stored config holds a grant worth connecting with. */
  protected abstract hasTokens(config: TConfig): boolean;

  /**
   * Build the provider's client from a grant that has passed the token and
   * scope checks. start() reports CONNECTED once it resolves.
   */
  protected abstract connect(config: TConfig): Promise<void>;

  /** Drop whatever connect() built. stop() reports DISCONNECTED afterwards. */
  protected disconnect(): void {}

  /** Whether a connect() failure means the user has to authorize again. */
  protected isReauthRequiredError(_error: unknown): boolean {
    return false;
  }

  /** The stored config; throws if initialize() hasn't supplied credentials. */
  protected requireConfig(): TConfig {
    if (!this.config) {
      throw new Error(`${this.name} client credentials are not configured`);
    }
    return this.config;
  }

  /**
   * Read a token endpoint's JSON body against `schema`, so a response missing what we need fails
   * here rather than being saved as `undefined` tokens. Schemas for a provider's responses aren't
   * strict: the provider may add fields, and only the ones we use have to be there.
   */
  protected async parseTokenResponse<T>(schema: z.ZodType<T>, response: Response): Promise<T> {
    const result = schema.safeParse(await response.json());
    if (!result.success) {
      throw new Error(
        `Unexpected token response for ${this.name}:\n${z.prettifyError(result.error)}`
      );
    }
    return result.data;
  }

  /**
   * Merge newly issued tokens into the config and store it (encrypted). The
   * in-memory config is updated first, so the tokens stay in use even if
   * storing them fails.
   */
  protected saveTokens(patch: Partial<TConfig>): void {
    this.config = { ...this.requireConfig(), ...patch };
    this.stateRepo.saveConfig(this.name, this.config);
  }

  /**
   * saveTokens() for a refresh listener, where a throw would escape into the
   * SDK's event emitter: a failed save is logged instead. The refreshed tokens
   * stay in use either way.
   */
  protected saveRefreshedTokens(patch: Partial<TConfig>): void {
    try {
      this.saveTokens(patch);
    } catch (error) {
      this.logger.error('Failed to save refreshed tokens', error);
    }
  }
}

/** Scopes from a token response's space-separated `scope`, as OAuth 2.0 specifies it. */
export function parseScopes(scope: string | undefined | null): string[] | undefined {
  return scope ? scope.split(' ').filter(Boolean) : undefined;
}
