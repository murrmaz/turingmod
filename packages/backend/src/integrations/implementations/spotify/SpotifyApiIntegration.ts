import { type AccessToken, type IAuthStrategy, SpotifyApi } from '@spotify/web-api-ts-sdk';
import { IntegrationGroup, IntegrationStatus, messageOf } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from '../../interfaces/IIntegration.js';
import { SpotifyAuthIntegration } from './SpotifyAuthIntegration.js';

/** A Spotify Web API call answered with a non-2xx status. */
export class SpotifyHttpError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`Spotify API responded ${status}${body ? `: ${body}` : ''}`);
    this.name = 'SpotifyHttpError';
  }
}

/**
 * The Spotify Web API connection: one SDK instance, and the integration status
 * that says whether it can be used.
 *
 * Owns connection health only. The SDK takes its access token from
 * SpotifyAuthIntegration on every call, so it never holds a stale one and
 * never needs rebuilding, and request() retries once with a fresh token when
 * Spotify rejects one early. What is done with Spotify — which endpoints, and
 * what to make of the answer — belongs to the feature using it (`!song`).
 *
 * Depends on: SpotifyAuthIntegration
 */
@injectable()
@singleton()
export class SpotifyApiIntegration extends BaseIntegration {
  readonly name = 'spotify-api';

  private readonly sdk: SpotifyApi;

  constructor(
    logger: Logger,
    private authIntegration: SpotifyAuthIntegration
  ) {
    super(logger, { component: 'SpotifyAPI' });
    this.sdk = new SpotifyApi(this.tokenFromAuthIntegration(), {
      responseValidator: { validateResponse: rejectUnsuccessful },
    });
  }

  /**
   * Get integration dependencies
   */
  override getDependencies(): IIntegration[] {
    return [this.authIntegration];
  }

  /**
   * Holds nothing bound to the grant — every call asks the auth integration
   * for its token — so a Spotify auth failure blocks this integration rather
   * than stopping it.
   */
  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.BLOCK;
  }

  override getGroup(): IntegrationGroup {
    return IntegrationGroup.SPOTIFY;
  }

  start(): Promise<void> {
    this.logger.debug('Starting Spotify API integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    if (this.authIntegration.getStatus() !== IntegrationStatus.CONNECTED) {
      const error = new Error(
        'SpotifyAuthIntegration must be started before SpotifyApiIntegration'
      );
      this.logger.error('Failed to start Spotify API integration', error);
      this.setStatus(IntegrationStatus.ERROR, messageOf(error));
      return Promise.reject(error);
    }

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.debug('Spotify API integration started successfully');
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.debug('Spotify API integration stopped');
    return Promise.resolve();
  }

  /**
   * Run a Spotify Web API call. Throws while Spotify auth isn't connected.
   * A 401 on a token that hadn't expired yet (revoked, or rotated elsewhere)
   * gets one refresh and one retry; if the refresh fails because the grant is
   * gone, SpotifyAuthIntegration reports NEEDS_REAUTH.
   *
   * Note that the SDK answers a 204 — "nothing is playing", for one — with
   * null, whatever its declared return type says.
   */
  async request<T>(call: (sdk: SpotifyApi) => Promise<T>): Promise<T> {
    if (this.authIntegration.getStatus() !== IntegrationStatus.CONNECTED) {
      throw new Error('Spotify is not connected');
    }
    try {
      return await call(this.sdk);
    } catch (error) {
      if (!(error instanceof SpotifyHttpError && error.status === 401)) {
        throw error;
      }
      this.logger.info('Spotify rejected the access token; refreshing and retrying');
      await this.authIntegration.refreshAccessToken();
      return await call(this.sdk);
    }
  }

  /**
   * The SDK's auth strategy, reduced to asking SpotifyAuthIntegration. The
   * SDK's own strategies refresh tokens themselves, without the client secret
   * this grant needs, and keep the result to themselves.
   */
  private tokenFromAuthIntegration(): IAuthStrategy {
    const current = async (): Promise<AccessToken> => ({
      access_token: await this.authIntegration.getAccessToken(),
      token_type: 'Bearer',
      // Unused: expiry and refresh are SpotifyAuthIntegration's business.
      expires_in: 0,
      refresh_token: '',
    });
    return {
      setConfiguration: () => undefined,
      getOrCreateAccessToken: current,
      getAccessToken: current,
      removeAccessToken: () => undefined,
    };
  }
}

/** Throw a SpotifyHttpError, which carries its status, for anything but a 2xx. */
async function rejectUnsuccessful(response: Response): Promise<void> {
  if (!response.ok) {
    throw new SpotifyHttpError(response.status, await response.text());
  }
}
