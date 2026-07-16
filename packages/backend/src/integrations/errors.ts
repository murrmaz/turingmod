/**
 * Thrown when an OAuth-capable integration has no credentials available from
 * either the database or environment variables. This is an expected
 * first-run condition (the frontend catches it and shows the Setup modal),
 * not a genuine failure, so callers should log it at a lower severity than
 * unexpected errors.
 */
export class OAuthNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthNotConfiguredError';
  }
}
