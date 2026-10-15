import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';

/** obs-websocket-js's error: a close code (or -1) and a reason. */
class FakeObsError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

/** The client as ObsIntegration sees it: connect, disconnect, and events. */
class FakeOBSWebSocket extends EventEmitter {
  static instance: FakeOBSWebSocket;
  /** What each connect() does, in order; a connect past the end succeeds. */
  outcomes: (FakeObsError | 'ok')[] = [];
  connects = 0;
  open = false;

  constructor() {
    super();
    FakeOBSWebSocket.instance = this;
  }

  connect(): Promise<void> {
    this.connects++;
    const outcome = this.outcomes.shift() ?? 'ok';
    if (outcome === 'ok') {
      this.open = true;
      return Promise.resolve();
    }
    this.emit('ConnectionClosed', outcome);
    return Promise.reject(outcome);
  }

  disconnect(): Promise<void> {
    if (this.open) {
      this.open = false;
      this.emit('ConnectionClosed', new FakeObsError(1000, ''));
    }
    return Promise.resolve();
  }

  /** OBS going away on its own: quit, crashed, or restarted. */
  drop(code = 1006): void {
    this.open = false;
    this.emit('ConnectionClosed', new FakeObsError(code, 'gone'));
  }
}

vi.mock('obs-websocket-js', () => ({ default: FakeOBSWebSocket }));

const { ObsIntegration } = await import('./ObsIntegration.js');

const unreachable = () => new FakeObsError(-1, 'connect ECONNREFUSED 127.0.0.1:4455');

describe('ObsIntegration', () => {
  let eventBus: EventBus;
  let integration: InstanceType<typeof ObsIntegration>;
  let socket: FakeOBSWebSocket;

  beforeEach(async () => {
    vi.useFakeTimers();
    const logger = new Logger({ level: 'silent' });
    eventBus = new EventBus(logger);
    integration = new ObsIntegration(eventBus, logger);
    socket = FakeOBSWebSocket.instance;
    await integration.initialize({});
  });

  afterEach(async () => {
    await integration.stop();
    vi.useRealTimers();
  });

  it('forwards each OBS event once, however often it has reconnected', async () => {
    const changed = vi.fn();
    eventBus.on('obs.scene.changed', changed);
    await integration.start();
    socket.drop();
    await integration.start(); // Start from the console, as before reconnecting existed
    socket.drop();
    await vi.advanceTimersByTimeAsync(2_000); // and a reconnect

    socket.emit('CurrentProgramSceneChanged', { sceneName: 'Gameplay', sceneUuid: 'g' });

    expect(changed).toHaveBeenCalledOnce();
  });

  it('keeps trying while OBS is unreachable, backing off, and connects once it is up', async () => {
    socket.outcomes = [unreachable(), unreachable(), unreachable()];

    await integration.start(); // resolves: retrying isn't a failure
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    expect(integration.getErrorMessage()).toMatch(/Can't reach OBS.*retrying in 2s/);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.connects).toBe(2);
    expect(integration.getErrorMessage()).toMatch(/retrying in 4s/);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(socket.connects).toBe(3);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(socket.connects).toBe(4);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(integration.getErrorMessage()).toBeUndefined();
  });

  it('waits no more than 30s between attempts', async () => {
    socket.outcomes = Array.from({ length: 8 }, unreachable);

    await integration.start();
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000);

    expect(integration.getErrorMessage()).toMatch(/retrying in 30s/);
  });

  it('reconnects when OBS goes away on its own', async () => {
    await integration.start();

    socket.drop();
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('stops retrying when stopped', async () => {
    socket.outcomes = [unreachable()];
    await integration.start();

    await integration.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.connects).toBe(1);
    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('does not treat its own disconnect as OBS going away', async () => {
    await integration.start();

    await integration.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.connects).toBe(1);
  });

  it('reports a wrong password as an error, without retrying', async () => {
    await integration.initialize({ password: 'hunter2' });
    socket.outcomes = [new FakeObsError(4009, 'Authentication failed.')];

    await expect(integration.start()).rejects.toThrow(/rejected the password/);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(socket.connects).toBe(1);
  });

  it('says a password is needed when OBS asks for one and none is set', async () => {
    socket.outcomes = [new FakeObsError(4009, 'Authentication failed.')];

    await expect(integration.start()).rejects.toThrow(/requires a password/);
  });

  it('stops retrying when OBS closes the session for good', async () => {
    await integration.start();

    socket.drop(4011);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(socket.connects).toBe(1);
  });
});
