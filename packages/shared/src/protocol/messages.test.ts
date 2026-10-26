import { describe, expect, it } from 'vitest';
import { createActivityListMessage, createMessage, MessageType } from './messages.js';

describe('createMessage', () => {
  it('stamps a generated id, type, and payload', () => {
    const message = createMessage(MessageType.ACTIVITY_LIST, { entries: [] });

    expect(message.type).toBe(MessageType.ACTIVITY_LIST);
    expect(message.payload).toEqual({ entries: [] });
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof message.timestamp).toBe('number');
  });

  it('uses the provided id instead of generating one', () => {
    const message = createMessage(MessageType.ACTIVITY_LIST, { entries: [] }, 'fixed-id');
    expect(message.id).toBe('fixed-id');
  });
});

describe('createActivityListMessage', () => {
  it('correlates the response to the original request id', () => {
    const message = createActivityListMessage([], 'original-id');

    expect(message.id).toBe('original-id');
    expect(message.type).toBe(MessageType.ACTIVITY_LIST);
  });
});
