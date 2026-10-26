import { createMessage, MessageType } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionError,
  type ConnectionState,
  NOT_CONNECTED_MESSAGE,
  WebSocketClient,
} from './WebSocketClient';

/**
 * Minimal mock of the browser WebSocket, just enough for WebSocketClient's usage:
 * assigning onopen/onclose/onerror/onmessage, send(), close(), and readyState.
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
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

  /** Test helper: the connection opens. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: simulate the server/network dropping the connection. */
  simulateClose(code: number, reason: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Test helper: simulate the server pushing a response for a given message id. */
  respondTo(originalId: string, payload: Record<string, unknown> = {}): void {
    this.onmessage?.({
      data: JSON.stringify(createMessage(MessageType.ACTIVITY_LIST, payload, originalId)),
    });
  }
}

describe('WebSocketClient', () => {
  /** Every socket the client has created, oldest first. */
  let sockets: MockWebSocket[];
  let client: WebSocketClient;
  let states: ConnectionState[];

  const latest = (): MockWebSocket => {
    const socket = sockets.at(-1);
    if (!socket) {
      throw new Error('No socket was created');
    }
    return socket;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    const WebSocketMock = vi.fn(function createMockWebSocket() {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    });
    Object.assign(WebSocketMock, {
      CONNECTING: MockWebSocket.CONNECTING,
      OPEN: MockWebSocket.OPEN,
      CLOSED: MockWebSocket.CLOSED,
    });
    vi.stubGlobal('WebSocket', WebSocketMock);
    client = new WebSocketClient({ url: 'ws://localhost:8080/ws' });
    states = [];
    client.onStateChange((state) => states.push(state));
    client.connect();
    latest().simulateOpen();
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects a pending sendAndWaitForResponse immediately when disconnect() is called', async () => {
    const message = createMessage(MessageType.ACTIVITY_QUERY, {});
    const promise = client.sendAndWaitForResponse(message);

    client.disconnect();

    await expect(promise).rejects.toThrow('Connection closed');
  });

  it('rejects a pending sendAndWaitForResponse when the socket closes unexpectedly', async () => {
    const message = createMessage(MessageType.ACTIVITY_QUERY, {});
    const promise = client.sendAndWaitForResponse(message);

    latest().simulateClose(1006, 'abnormal closure');

    await expect(promise).rejects.toThrow('Connection closed');
  });

  it('rejects a request made while disconnected at once, and never sends it later', async () => {
    latest().simulateClose(1006, 'abnormal closure');

    const promise = client.sendAndWaitForResponse(createMessage(MessageType.ACTIVITY_QUERY, {}));
    await expect(promise).rejects.toThrow(NOT_CONNECTED_MESSAGE);

    vi.advanceTimersByTime(1000);
    latest().simulateOpen();
    expect(latest().sent).toHaveLength(0);
  });

  it('tells connection failures apart from errors the backend answered with', async () => {
    const answered = createMessage(MessageType.ACTIVITY_QUERY, {});
    const refused = client.sendAndWaitForResponse(answered);
    latest().onmessage?.({
      data: JSON.stringify({
        ...createMessage(MessageType.ERROR, { code: 'INVALID_PAYLOAD', message: 'Bad payload' }),
        id: answered.id,
      }),
    });
    const refusal = await refused.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toBeInstanceOf(ConnectionError);

    const lost = client.sendAndWaitForResponse(createMessage(MessageType.ACTIVITY_QUERY, {}));
    latest().simulateClose(1006, 'abnormal closure');
    await expect(lost).rejects.toBeInstanceOf(ConnectionError);

    const never = client.sendAndWaitForResponse(createMessage(MessageType.ACTIVITY_QUERY, {}));
    await expect(never).rejects.toBeInstanceOf(ConnectionError);
  });

  it('reconnects after an unexpected close, backing off while attempts keep failing', () => {
    latest().simulateClose(1006, 'abnormal closure');
    expect(client.getState()).toBe('reconnecting');

    // 1s, then 2s, then 4s.
    for (const delay of [1000, 2000, 4000]) {
      const before = sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(before + 1);
      latest().simulateClose(1006, 'refused');
    }

    vi.advanceTimersByTime(8000);
    latest().simulateOpen();
    expect(client.getState()).toBe('connected');
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });

  it('starts the backoff over once a connection succeeds', () => {
    latest().simulateClose(1006, 'abnormal closure');
    vi.advanceTimersByTime(1000);
    latest().simulateClose(1006, 'refused');
    vi.advanceTimersByTime(2000);
    latest().simulateOpen();

    latest().simulateClose(1006, 'abnormal closure');
    const before = sockets.length;
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(before + 1);
  });

  it('caps the wait between attempts at 30 seconds', () => {
    latest().simulateClose(1006, 'abnormal closure');
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      vi.advanceTimersByTime(delay);
      latest().simulateClose(1006, 'refused');
    }
    const before = sockets.length;
    vi.advanceTimersByTime(30_000);
    expect(sockets).toHaveLength(before + 1);
  });

  it('retries immediately when connect() is called while waiting', () => {
    latest().simulateClose(1006, 'abnormal closure');
    const before = sockets.length;

    client.connect();
    expect(sockets).toHaveLength(before + 1);

    // The scheduled retry was replaced, not added to.
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(before + 1);
  });

  it('stops reconnecting after disconnect()', () => {
    latest().simulateClose(1006, 'abnormal closure');
    client.disconnect();
    const before = sockets.length;

    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(before);
    expect(client.getState()).toBe('closed');
  });

  it("ignores a replaced socket's late events", async () => {
    const old = latest();
    client.disconnect();
    client.connect();
    latest().simulateOpen();

    const message = createMessage(MessageType.ACTIVITY_QUERY, {});
    const promise = client.sendAndWaitForResponse(message);
    old.onclose?.({ code: 1006, reason: 'late close' });

    expect(client.getState()).toBe('connected');
    latest().respondTo(message.id, { result: 'ok' });
    await expect(promise).resolves.toMatchObject({ id: message.id });
  });

  it('still resolves new requests normally after a reconnect', async () => {
    const first = client.sendAndWaitForResponse(createMessage(MessageType.ACTIVITY_QUERY, {}));
    latest().simulateClose(1006, 'abnormal closure');
    await expect(first).rejects.toThrow('Connection closed');

    vi.advanceTimersByTime(1000);
    latest().simulateOpen();

    const message = createMessage(MessageType.ACTIVITY_QUERY, {});
    const second = client.sendAndWaitForResponse(message);
    latest().respondTo(message.id, { result: 'ok' });

    await expect(second).resolves.toMatchObject({ id: message.id });
  });
});
