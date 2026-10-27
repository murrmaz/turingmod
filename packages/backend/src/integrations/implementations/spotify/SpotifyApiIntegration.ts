import { type AccessToken, type IAuthStrategy, SpotifyApi } from '@spotify/web-api-ts-sdk';
import { IntegrationName } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { Logger } from '../../../utils/Logger.js';
import { AuthorizedApiIntegration } from '../../AuthorizedApiIntegration.js';
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
 * The Spotify Web API connection: one SDK instance (see AuthorizedApiIntegration).
 *
 * The SDK takes its access token from SpotifyAuthIntegration on every call, so
 * it never holds a stale one and never needs rebuilding, and request() retries
 * once with a fresh token when Spotify rejects one early. What is done with
 * Spotify — which endpoints, and what to make of the answer — belongs to the
 * feature using it (`!song`).
 *
 * Note that the SDK answers a 204 — "nothing is playing", for one — with
 * null, whatever its declared return type says.
 *
 * Depends on: SpotifyAuthIntegration
 */
@singleton()
export class SpotifyApiIntegration extends AuthorizedApiIntegration<
  SpotifyAuthIntegration,
  SpotifyApi
> {
  readonly name = IntegrationName.SPOTIFY_API;

  private readonly sdk: SpotifyApi;

  constructor(logger: Logger, authIntegration: SpotifyAuthIntegration) {
    super(logger, 'Spotify', authIntegration);
    this.sdk = new SpotifyApi(this.tokenFromAuthIntegration(), {
      responseValidator: { validateResponse: rejectUnsuccessful },
    });
  }

  protected resolveClient(): SpotifyApi {
    return this.sdk;
  }

  /**
   * A 401 on a token that hadn't expired yet (revoked, or rotated elsewhere)
   * gets one refresh and one retry; if the refresh fails because the grant is
   * gone, SpotifyAuthIntegration reports NEEDS_REAUTH.
   */
  protected override async onRequestFailure<T>(
    error: unknown,
    retry: () => Promise<T>
  ): Promise<T> {
    if (!(error instanceof SpotifyHttpError && error.status === 401)) {
      throw error;
    }
    this.logger.info('Spotify rejected the access token; refreshing and retrying');
    await this.auth.refreshAccessToken();
    return await retry();
  }

  /**
   * The SDK's auth strategy, reduced to asking SpotifyAuthIntegration. The
   * SDK's own strategies refresh tokens themselves, without the client secret
   * this grant needs, and keep the result to themselves.
   */
  private tokenFromAuthIntegration(): IAuthStrategy {
    const current = async (): Promise<AccessToken> => ({
      access_token: await this.auth.getAccessToken(),
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
