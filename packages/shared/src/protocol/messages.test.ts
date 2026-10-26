import { describe, expect, it } from 'vitest';
import { createMessage, createOAuthAuthUrlResponseMessage, MessageType } from './messages.js';

describe('createMessage', () => {
  it('stamps a generated id, type, and payload', () => {
    const message = createMessage(MessageType.OAUTH_RESULT, {
      integrationName: 'obs',
      success: true,
    });

    expect(message.type).toBe(MessageType.OAUTH_RESULT);
    expect(message.payload).toEqual({ integrationName: 'obs', success: true });
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof message.timestamp).toBe('number');
  });

  it('uses the provided id instead of generating one', () => {
    const message = createMessage(MessageType.OAUTH_RESULT, {}, 'fixed-id');
    expect(message.id).toBe('fixed-id');
  });
});

describe('createOAuthAuthUrlResponseMessage', () => {
  it('correlates the response to the original request id', () => {
    const message = createOAuthAuthUrlResponseMessage('twitch-auth', 'https://x', 'original-id');

    expect(message.id).toBe('original-id');
    expect(message.type).toBe(MessageType.OAUTH_AUTH_URL_RESPONSE);
  });
});
