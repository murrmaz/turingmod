import type { Platform } from '@turingmod/shared';

/**
 * Thrown by an IStreamPlatform when it cannot act because the platform's OAuth
 * grant is unusable and nothing it can do will fix that.
 *
 * Recoverable auth states never reach here: an expired access token is refreshed
 * transparently by the provider on the next API call. By the time a platform
 * throws this, the only remedy is a human completing the OAuth flow again —
 * either because it was never completed (`needsReauth: false`) or because the
 * grant was revoked or its refresh token rejected (`needsReauth: true`).
 */
export class NotAuthenticatedError extends Error {
  constructor(
    readonly platform: Platform,
    readonly needsReauth: boolean,
    message: string
  ) {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}
