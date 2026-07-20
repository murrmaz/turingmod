import { describe, expect, it } from 'vitest';
import { PermissionLevel } from '../constants/permissions.js';
import { Platform } from '../constants/platform.js';
import type { CommandContext } from '../types/command.js';
import {
  createCommandExecuteMessage,
  createCommandResultMessage,
  createIntegrationStartMessage,
  createMessage,
  MessageType,
} from './messages.js';

const context: Omit<CommandContext, 'args'> = {
  user: {
    id: 'u1',
    platform: Platform.TWITCH,
    platformUserId: '123',
    username: 'someone',
    permissionLevel: PermissionLevel.VIEWER,
  },
  platform: Platform.TWITCH,
  metadata: {},
  isSimulation: false,
};

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

describe('createCommandExecuteMessage', () => {
  it('wraps the payload with COMMAND_EXECUTE type', () => {
    const payload = { command: 'ping', args: [], context };
    const message = createCommandExecuteMessage(payload);

    expect(message.type).toBe(MessageType.COMMAND_EXECUTE);
    expect(message.payload).toEqual(payload);
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
