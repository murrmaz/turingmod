import { HttpStatusCodeError } from '@twurple/api-call';

/** The parts of a Twitch token request's query that must never be shown or logged. */
const SECRET_PARAMS = /\b(client_secret|refresh_token)=[^&\s]*/g;

/**
 * Take the credentials out of a failed token request's error. Twurple sends the client secret and
 * refresh token in the URL's query, and HttpStatusCodeError keeps that URL in its message, its stack
 * and a field of its own, each of which can reach the console, the activity log or the terminal log.
 *
 * Changes the error itself, rather than making a clean copy, because Twurple rethrows the same
 * object to whoever asked for the token. Every other error is left alone.
 */
export function redactTokenRequest(error: unknown): void {
  if (!(error instanceof HttpStatusCodeError)) {
    return;
  }
  const fields = error as unknown as Record<string, unknown>;
  for (const key of ['message', 'stack', ...Object.keys(fields)]) {
    const value = fields[key];
    if (typeof value === 'string') {
      fields[key] = value.replace(SECRET_PARAMS, '$1=<redacted>');
    }
  }
}
