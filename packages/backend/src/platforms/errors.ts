import type { StreamingPlatform } from '@turingmod/shared';

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
    readonly platform: StreamingPlatform,
    readonly needsReauth: boolean,
    message: string
  ) {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Thrown by an IStreamPlatform when the platform has no such value as the one asked for (a game
 * that doesn't exist). Nothing is wrong with the platform, and the message is written for whoever
 * asked, so a command may repeat it in chat; any other platform error stays out of chat.
 */
export class InvalidStreamInfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStreamInfoError';
  }
}
