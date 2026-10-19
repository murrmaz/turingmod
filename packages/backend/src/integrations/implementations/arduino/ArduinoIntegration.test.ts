import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';

/** The `ws` client as ArduinoIntegration sees it, driven by each test playing the board. */
class FakeWebSocket extends EventEmitter {
  static sockets: FakeWebSocket[] = [];
  static get latest(): FakeWebSocket {
    const socket = FakeWebSocket.sockets.at(-1);
    if (!socket) {
      throw new Error('No socket was opened');
    }
    return socket;
  }

  readonly sent: unknown[] = [];
  pings = 0;
  closed = false;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  ping(): void {
    this.pings++;
  }

  /** Like ws, the close is reported asynchronously. */
  terminate(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    queueMicrotask(() => this.emit('close', 1006, Buffer.alloc(0)));
  }

  // ── The board's side ──

  accept(): void {
    this.emit('open');
  }

  receive(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }

  receiveText(text: string): void {
    this.emit('message', Buffer.from(text), false);
  }

  /** The connection failing or dropping, as ws reports it: an error, then the close. */
  fail(message = 'connect ECONNREFUSED 192.168.1.50:81'): void {
    this.emit('error', new Error(message));
    this.terminate();
  }
}

vi.mock('ws', () => ({
  // biome-ignore lint/style/useNamingConvention: mirrors the exported class name.
  WebSocket: FakeWebSocket,
}));

const { ArduinoIntegration } = await import('./ArduinoIntegration.js');

const HELLO = { type: 'hello', protocol: 1, name: 'turingmod-arm', firmware: '0.1.0', servos: 3 };

describe('ArduinoIntegration', () => {
  let eventBus: EventBus;
  let integration: InstanceType<typeof ArduinoIntegration>;

  /** Start, and play a board that accepts and answers hello. */
  async function connect(): Promise<FakeWebSocket> {
    const started = integration.start();
    const socket = FakeWebSocket.latest;
    socket.accept();
    socket.receive(HELLO);
    await started;
    return socket;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    FakeWebSocket.sockets = [];
    const logger = new Logger({ level: 'silent' });
    eventBus = new EventBus(logger);
    integration = new ArduinoIntegration(eventBus, logger);
    await integration.initialize({ url: 'ws://192.168.1.50:81' });
  });

  afterEach(async () => {
    await integration.stop();
    vi.useRealTimers();
  });

  it('is connected only once the board has answered hello', async () => {
    const started = integration.start();
    const socket = FakeWebSocket.latest;
    expect(socket.url).toBe('ws://192.168.1.50:81');

    socket.accept();
    expect(socket.sent).toEqual([{ type: 'hello', protocol: 1 }]);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);

    socket.receive(HELLO);
    await started;
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(integration.getDevice()).toEqual({
      protocol: 1,
      name: 'turingmod-arm',
      firmware: '0.1.0',
      servos: 3,
    });
  });

  it("defaults to the reference firmware's mDNS name", async () => {
    await integration.initialize({});
    void integration.start();

    expect(FakeWebSocket.latest.url).toBe('ws://turingmod-arm.local:81');
  });

  it('publishes what the board sends after hello, and drops what it cannot read', async () => {
    const received = vi.fn();
    eventBus.on('arduino.message', received);
    const socket = await connect();

    socket.receive({ type: 'log', text: 'servo 2 homed' });
    socket.receiveText('not json');
    socket.receive({ text: 'no type' });
    socket.emit('message', Buffer.from([1, 2, 3]), true);

    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith({ type: 'log', text: 'servo 2 homed' });
  });

  it('ignores anything the board sends before it answers hello', async () => {
    const received = vi.fn();
    eventBus.on('arduino.message', received);
    const started = integration.start();
    const socket = FakeWebSocket.latest;
    socket.accept();

    socket.receive({ type: 'log', text: 'booted' });
    socket.receiveText('not json');
    socket.emit('message', Buffer.from([1, 2, 3]), true);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);

    socket.receive(HELLO);
    await started;
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(received).not.toHaveBeenCalled();
  });

  it('publishes at most 20 messages a second', async () => {
    const received = vi.fn();
    eventBus.on('arduino.message', received);
    const socket = await connect();
    await vi.advanceTimersByTimeAsync(1_000); // a fresh window, past the one hello counted in

    for (let i = 0; i < 25; i++) {
      socket.receive({ type: 'tick', i });
    }
    expect(received).toHaveBeenCalledTimes(20);

    await vi.advanceTimersByTimeAsync(1_000);
    socket.emit('pong');
    socket.receive({ type: 'tick', i: 25 });
    expect(received).toHaveBeenCalledTimes(21);
  });

  it('keeps backing off from a board that drops straight after hello', async () => {
    const socket = await connect();
    socket.fail('read ECONNRESET');
    await vi.advanceTimersByTimeAsync(0);
    expect(integration.getErrorMessage()).toMatch(/retrying in 2s/);

    await vi.advanceTimersByTimeAsync(2_000);
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive(HELLO);
    FakeWebSocket.latest.fail('read ECONNRESET');
    await vi.advanceTimersByTimeAsync(0);

    expect(integration.getErrorMessage()).toMatch(/retrying in 4s/);
  });

  it('starts the delays over after a connection that lasted', async () => {
    const socket = await connect();
    for (let elapsed = 0; elapsed < 30_000; elapsed += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      socket.emit('pong');
    }
    socket.fail('read ECONNRESET');
    await vi.advanceTimersByTimeAsync(0);
    expect(integration.getErrorMessage()).toMatch(/retrying in 2s/);

    await vi.advanceTimersByTimeAsync(2_000);
    FakeWebSocket.latest.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(integration.getErrorMessage()).toMatch(/retrying in 4s/);
  });

  it('reports the address in use, for the setup dialog', async () => {
    expect(integration.getAddress()).toBe('ws://192.168.1.50:81');
    await integration.initialize({});
    expect(integration.getAddress()).toBe('ws://turingmod-arm.local:81');
  });

  it('keeps trying while the board is unreachable, backing off, and connects once it is up', async () => {
    const started = integration.start();
    FakeWebSocket.latest.fail();
    await started; // resolves: retrying isn't a failure
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    expect(integration.getErrorMessage()).toMatch(/ECONNREFUSED.*retrying in 2s/);

    await vi.advanceTimersByTimeAsync(2_000);
    FakeWebSocket.latest.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(integration.getErrorMessage()).toMatch(/retrying in 4s/);

    await vi.advanceTimersByTimeAsync(4_000);
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive(HELLO);

    expect(FakeWebSocket.sockets).toHaveLength(3);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(integration.getErrorMessage()).toBeUndefined();
  });

  it('waits no more than 30s between attempts', async () => {
    const started = integration.start();
    FakeWebSocket.latest.fail();
    await started;
    for (const delayMs of [2_000, 4_000, 8_000, 16_000]) {
      await vi.advanceTimersByTimeAsync(delayMs);
      FakeWebSocket.latest.fail();
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(integration.getErrorMessage()).toMatch(/retrying in 30s/);
  });

  it('gives up on a socket that never answers hello, and tries again', async () => {
    const started = integration.start();
    FakeWebSocket.latest.accept();
    await vi.advanceTimersByTimeAsync(5_000);
    await started;

    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    expect(integration.getErrorMessage()).toMatch(/didn't answer hello within 5s/);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.sockets).toHaveLength(2);
  });

  it('is an error, not retried, when the firmware speaks another protocol version', async () => {
    const started = integration.start();
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive({ ...HELLO, protocol: 2 });

    await expect(started).rejects.toThrow(/protocol 2, and TuringMod speaks 1/);
    expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.sockets).toHaveLength(1);
  });

  it('is an error when the answer to hello is not a hello reply', async () => {
    const started = integration.start();
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive({ type: 'hello', protocol: 1 });

    await expect(started).rejects.toThrow(/answered hello with something TuringMod can't read/);
    expect(integration.getErrorMessage()).toMatch(/name/);
  });

  it('notices a board that stops answering pings, and reconnects', async () => {
    const socket = await connect();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.pings).toBe(1);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);

    await vi.advanceTimersByTimeAsync(5_000); // no pong for the second ping
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    expect(integration.getErrorMessage()).toMatch(/stopped answering pings.*retrying in 2s/);
    expect(integration.getDevice()).toBeNull();
  });

  it('reconnects when the board goes away on its own', async () => {
    const socket = await connect();

    socket.fail('read ECONNRESET');
    await vi.advanceTimersByTimeAsync(0);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    expect(integration.getErrorMessage()).toMatch(
      /Lost the connection.*ECONNRESET.*retrying in 2s/
    );

    await vi.advanceTimersByTimeAsync(2_000);
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive(HELLO);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('stops retrying when stopped', async () => {
    const started = integration.start();
    FakeWebSocket.latest.fail();
    await started;

    await integration.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.sockets).toHaveLength(1);
    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('closes the socket when stopped, and ignores what it reports afterwards', async () => {
    const socket = await connect();

    await integration.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.closed).toBe(true);
    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
    expect(FakeWebSocket.sockets).toHaveLength(1);
  });

  it('rejects a config whose address is not a WebSocket URL', () => {
    expect(() => integration.initialize({ url: 'http://192.168.1.50' })).toThrow(
      /Expected a ws:\/\/ address/
    );
  });
});
