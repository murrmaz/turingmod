import 'reflect-metadata';
import { type ErrorPayload, type IWebSocketMessage, MessageType } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { MessageRouter } from './MessageRouter.js';

const message = (type: MessageType, payload: unknown): IWebSocketMessage => ({
  id: 'request-1',
  type,
  timestamp: 0,
  payload,
});

/** The error payload of a response the router must have produced. */
function errorOf(response: IWebSocketMessage | null): ErrorPayload {
  if (!response) {
    throw new Error('Expected an error response, got none');
  }
  return response.payload as ErrorPayload;
}

function routerWithAuthUrlHandler() {
  const router = new MessageRouter(new Logger({ level: 'silent' }));
  const handler = vi.fn((_message: IWebSocketMessage, _clientId: string) => Promise.resolve(null));
  router.registerHandler(MessageType.OAUTH_GET_AUTH_URL, handler);
  return { router, handler };
}

describe('MessageRouter', () => {
  it('hands a valid payload to its handler', async () => {
    const { router, handler } = routerWithAuthUrlHandler();

    await router.route(message(MessageType.OAUTH_GET_AUTH_URL, { integrationName: 'obs' }), 'c1');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { integrationName: 'obs' } }),
      'c1'
    );
  });

  it('answers a malformed payload with INVALID_PAYLOAD naming the field, without calling the handler', async () => {
    const { router, handler } = routerWithAuthUrlHandler();

    const response = await router.route(
      message(MessageType.OAUTH_GET_AUTH_URL, { integrationName: 42 }),
      'c1'
    );

    expect(handler).not.toHaveBeenCalled();
    const error = errorOf(response);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('integrationName');
    expect(response?.id).toBe('request-1');
  });

  it('rejects a payload carrying a field its schema does not declare', async () => {
    const { router, handler } = routerWithAuthUrlHandler();

    const response = await router.route(
      message(MessageType.OAUTH_GET_AUTH_URL, { integrationName: 'obs', force: true }),
      'c1'
    );

    expect(handler).not.toHaveBeenCalled();
    expect(errorOf(response).code).toBe('INVALID_PAYLOAD');
  });

  it('answers a type with no handler with UNKNOWN_MESSAGE_TYPE', async () => {
    const { router } = routerWithAuthUrlHandler();

    const response = await router.route(message(MessageType.COMMAND_RESULT, {}), 'c1');

    expect(errorOf(response).code).toBe('UNKNOWN_MESSAGE_TYPE');
  });
});
