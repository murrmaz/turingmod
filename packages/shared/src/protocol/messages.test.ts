import { describe, expect, it } from 'vitest';
import {
  createCommandResultMessage,
  createIntegrationStartMessage,
  createMessage,
  MessageType,
} from './messages.js';

describe('createMessage', () => {
  it('stamps a generated id, type, and payload', () => {
    const message = createMessage(MessageType.PING, {});

    expect(message.type).toBe(MessageType.PING);
    expect(message.payload).toEqual({});
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof message.timestamp).toBe('number');
  });

  it('uses the provided id instead of generating one', () => {
    const message = createMessage(MessageType.PING, {}, 'fixed-id');
    expect(message.id).toBe('fixed-id');
  });
});

describe('createCommandResultMessage', () => {
  it('correlates the response to the original request id', () => {
    const message = createCommandResultMessage(
      { command: 'ping', result: { success: true, message: 'pong' }, isSimulation: false },
      'original-id'
    );

    expect(message.id).toBe('original-id');
    expect(message.type).toBe(MessageType.COMMAND_RESULT);
  });
});

describe('createIntegrationStartMessage', () => {
  it('builds a payload from the integration name', () => {
    const message = createIntegrationStartMessage('twitch');
    expect(message.payload).toEqual({ integrationName: 'twitch' });
  });
});
