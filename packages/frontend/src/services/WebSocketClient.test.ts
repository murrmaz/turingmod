import { createMessage, MessageType } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketClient } from './WebSocketClient';

/**
 * Minimal mock of the browser WebSocket, just enough for WebSocketClient's usage:
 * assigning onopen/onclose/onerror/onmessage, send(), close(), and readyState.
 */
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.simulateClose(1000, 'test close');
  }

  /** Test helper: simulate the server/network dropping the connection. */
  simulateClose(code: number, reason: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Test helper: simulate the server pushing a response for a given message id. */
  respondTo(originalId: string, payload: Record<string, unknown> = {}): void {
    this.onmessage?.({
      data: JSON.stringify(createMessage(MessageType.COMMAND_RESULT, payload, originalId)),
    });
  }
}

describe('WebSocketClient', () => {
  let mockWs: MockWebSocket;
  let client: WebSocketClient;

  beforeEach(() => {
    const WebSocketMock = vi.fn(function WebSocketMock() {
      mockWs = new MockWebSocket();
      return mockWs;
    });
    Object.assign(WebSocketMock, { OPEN: MockWebSocket.OPEN, CLOSED: MockWebSocket.CLOSED });
    vi.stubGlobal('WebSocket', WebSocketMock);
    client = new WebSocketClient({ url: 'ws://localhost:8080/ws' });
    client.connect();
    mockWs.onopen?.();
  });

  it('rejects a pending sendAndWaitForResponse immediately when disconnect() is called', async () => {
    const message = createMessage(MessageType.COMMAND_SIMULATE, {});
    const promise = client.sendAndWaitForResponse(message);

    client.disconnect();

    await expect(promise).rejects.toThrow('Connection closed');
  });

  it('rejects a pending sendAndWaitForResponse when the socket closes unexpectedly', async () => {
    const message = createMessage(MessageType.COMMAND_SIMULATE, {});
    const promise = client.sendAndWaitForResponse(message);

    mockWs.simulateClose(1006, 'abnormal closure');

    await expect(promise).rejects.toThrow('Connection closed');
  });

  it('drops a queued message on connection loss instead of resending it on reconnect', () => {
    mockWs.readyState = MockWebSocket.CLOSED;
    client.send(createMessage(MessageType.COMMAND_SIMULATE, {}));

    client.disconnect();

    client.connect();
    mockWs.onopen?.();

    expect(mockWs.sent).toHaveLength(0);
  });

  it('still resolves new requests normally after a prior connection loss', async () => {
    const first = client.sendAndWaitForResponse(createMessage(MessageType.COMMAND_SIMULATE, {}));
    mockWs.onclose?.({ code: 1006, reason: 'abnormal closure' });
    await expect(first).rejects.toThrow('Connection closed');

    client.connect();
    mockWs.onopen?.();

    const message = createMessage(MessageType.COMMAND_SIMULATE, {});
    const second = client.sendAndWaitForResponse(message);
    mockWs.respondTo(message.id, { result: 'ok' });

    await expect(second).resolves.toMatchObject({ id: message.id });
  });
});
