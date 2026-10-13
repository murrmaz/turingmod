import { describe, expect, it } from 'vitest';
import { messageOf, toError } from './errors.js';

describe('toError', () => {
  it('returns an Error unchanged', () => {
    const error = new TypeError('bad');
    expect(toError(error)).toBe(error);
  });

  it('wraps anything else, keeping it as the cause', () => {
    const thrown = { code: 42 };
    const error = toError(thrown);
    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBe(thrown);
    expect(toError('nope').message).toBe('nope');
  });
});

describe('messageOf', () => {
  it("uses an Error's message, or a thrown string", () => {
    expect(messageOf(new Error('bad'))).toBe('bad');
    expect(messageOf('nope')).toBe('nope');
  });

  it('falls back for anything else', () => {
    expect(messageOf({ code: 42 })).toBe('Unknown error');
    expect(messageOf(undefined, 'Failed to start')).toBe('Failed to start');
  });
});
