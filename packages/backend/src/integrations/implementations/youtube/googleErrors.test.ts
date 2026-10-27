import { describe, expect, it } from 'vitest';
import { connectionErrorCodeOf, httpStatusOf } from './googleErrors.js';

/** An Error with the extra fields gaxios or Node put on it. */
const errorWith = (fields: Record<string, unknown>) =>
  Object.assign(new Error('request failed'), fields);

describe('httpStatusOf', () => {
  it("reads the response's status first, then the mirrored status, then a numeric code", () => {
    expect(httpStatusOf(errorWith({ response: { status: 403 }, status: 500 }))).toBe(403);
    expect(httpStatusOf(errorWith({ response: undefined, status: 429 }))).toBe(429);
    expect(httpStatusOf(errorWith({ code: 401 }))).toBe(401);
  });

  it('has none for a connection that never got an answer', () => {
    expect(httpStatusOf(errorWith({ code: 'ECONNRESET' }))).toBeUndefined();
    expect(httpStatusOf(new Error('socket hang up'))).toBeUndefined();
    expect(httpStatusOf('not an error')).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
  });

  it('is not thrown off by a field of another type', () => {
    expect(httpStatusOf(errorWith({ status: 'INVALID', response: { status: 404 } }))).toBe(404);
    expect(httpStatusOf(errorWith({ response: 'gone', status: 503 }))).toBe(503);
  });
});

describe('connectionErrorCodeOf', () => {
  it("reads Node's string code, not Google's numeric one", () => {
    expect(connectionErrorCodeOf(errorWith({ code: 'ECONNRESET' }))).toBe('ECONNRESET');
    expect(connectionErrorCodeOf(errorWith({ code: 401 }))).toBeUndefined();
    expect(connectionErrorCodeOf(new Error('plain'))).toBeUndefined();
  });
});
