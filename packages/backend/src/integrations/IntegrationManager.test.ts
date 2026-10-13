import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import { Logger } from '../utils/Logger.js';
import { BaseIntegration } from './BaseIntegration.js';
import { IntegrationManager } from './IntegrationManager.js';
import { DependencyFailurePolicy, type IIntegration } from './interfaces/IIntegration.js';

class FakeIntegration extends BaseIntegration {
  stopped = false;
  startCount = 0;
  failOnStart = false;
  policy = DependencyFailurePolicy.STOP;

  constructor(
    readonly name: string,
    private dependencies: IIntegration[] = []
  ) {
    super(new Logger({ level: 'silent' }), { component: name });
  }

  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return this.policy;
  }

  getDependencies(): IIntegration[] {
    return this.dependencies;
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.startCount += 1;
    if (this.failOnStart) {
      this.setStatus(IntegrationStatus.ERROR, 'start failed');
      return Promise.reject(new Error('start failed'));
    }
    this.stopped = false;
    this.setStatus(IntegrationStatus.CONNECTED);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }

  reportConnecting(): void {
    this.setStatus(IntegrationStatus.CONNECTING);
  }

  reportConnected(): void {
    this.setStatus(IntegrationStatus.CONNECTED);
  }

  /** Simulate an OAuth token rotation. */
  refreshToken(expiresAt?: number): void {
    this.reportTokenRefreshed(expiresAt);
  }

  /** Simulate a dead refresh token. */
  failReauth(): void {
    this.setStatus(IntegrationStatus.NEEDS_REAUTH, 'needs reauth');
  }

  /** Simulate a non-auth runtime failure. */
  errorOut(): void {
    this.setStatus(IntegrationStatus.ERROR, 'transient error');
  }
}

interface FakeRepo extends IntegrationStateRepository {
  enabled: Set<string>;
}

function makeStateRepo(enabled: string[] = []): FakeRepo {
  const enabledSet = new Set(enabled);
  return {
    enabled: enabledSet,
    updateStatus: vi.fn().mockResolvedValue(undefined),
    getDecryptedConfig: vi.fn().mockResolvedValue(null),
    findByName: vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve({ name, enabled: enabledSet.has(name) })
      ),
  } as unknown as FakeRepo;
}

function makeManager(repo: IntegrationStateRepository): IntegrationManager {
  return new IntegrationManager(
    repo,
    new EventBus(new Logger({ level: 'silent' })),
    new Logger({ level: 'silent' })
  );
}

/**
 * The cascade and reconcile passes are kicked off from a synchronous
 * EventEmitter callback, so give the microtask queue room to drain.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('IntegrationManager', () => {
  let auth: FakeIntegration;
  let api: FakeIntegration;
  let eventsub: FakeIntegration;
  let unrelated: FakeIntegration;

  beforeEach(() => {
    auth = new FakeIntegration('twitch-auth');
    api = new FakeIntegration('twitch-api', [auth]);
    eventsub = new FakeIntegration('twitch-eventsub', [auth, api]);
    unrelated = new FakeIntegration('discord');
  });

  function registerTwitchTrio(manager: IntegrationManager): void {
    manager.register(auth);
    manager.register(api);
    manager.register(eventsub);
    manager.register(unrelated);
  }

  async function startAll(): Promise<void> {
    await auth.start();
    await api.start();
    await eventsub.start();
    await unrelated.start();
    await settle();
  }

  it('waits for a start from the console to finish before a cascade stops it', async () => {
    const manager = makeManager(makeStateRepo());
    registerTwitchTrio(manager);
    await auth.start();
    await api.start();
    await settle();

    const calls: string[] = [];
    let finishStart = (): void => {};
    eventsub.start = () => {
      calls.push('start');
      eventsub.reportConnecting();
      return new Promise<void>((resolve) => {
        finishStart = () => {
          calls.push('started');
          eventsub.reportConnected();
          resolve();
        };
      });
    };
    const stop = eventsub.stop.bind(eventsub);
    eventsub.stop = () => {
      calls.push('stop');
      return stop();
    };

    const started = manager.startIntegration('twitch-eventsub');
    await settle();
    auth.errorOut();
    await settle();
    finishStart();
    await started;
    await settle();

    expect(calls).toEqual(['start', 'started', 'stop']);
    expect(eventsub.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('stops transitive dependents when a dependency needs re-authorization', async () => {
    const manager = makeManager(makeStateRepo());
    registerTwitchTrio(manager);
    await startAll();

    auth.failReauth();
    await settle();

    expect(api.stopped).toBe(true);
    expect(eventsub.stopped).toBe(true);
    expect(auth.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(unrelated.stopped).toBe(false);
  });

  it('stops dependents when a dependency errors, not just on reauth', async () => {
    const manager = makeManager(makeStateRepo());
    registerTwitchTrio(manager);
    await startAll();

    auth.errorOut();
    await settle();

    expect(api.stopped).toBe(true);
    expect(eventsub.stopped).toBe(true);
  });

  it('stops dependents when a dependency is stopped by hand', async () => {
    const manager = makeManager(makeStateRepo());
    registerTwitchTrio(manager);
    await startAll();

    await manager.stopIntegration('twitch-auth');
    await settle();

    expect(api.stopped).toBe(true);
    expect(eventsub.stopped).toBe(true);
  });

  it('restarts cascade-stopped dependents once the dependency recovers', async () => {
    const manager = makeManager(makeStateRepo(['twitch-auth', 'twitch-api', 'twitch-eventsub']));
    registerTwitchTrio(manager);
    await startAll();

    auth.failReauth();
    await settle();
    expect(api.getStatus()).toBe(IntegrationStatus.DISCONNECTED);

    // Re-authorizing restarts only the auth integration; its dependents come
    // back on their own.
    await manager.startIntegration('twitch-auth');
    await settle();

    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(eventsub.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('does not restart a disabled dependent', async () => {
    const manager = makeManager(makeStateRepo(['twitch-auth', 'twitch-api']));
    registerTwitchTrio(manager);
    await startAll();

    auth.failReauth();
    await settle();
    await manager.startIntegration('twitch-auth');
    await settle();

    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
    // twitch-eventsub is not enabled, so it stays down.
    expect(eventsub.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('attempts a failing dependent once per cascade, never in a loop', async () => {
    const manager = makeManager(makeStateRepo(['twitch-auth', 'twitch-api']));
    registerTwitchTrio(manager);
    await startAll();

    auth.failReauth();
    await settle();

    api.failOnStart = true;
    const beforeRestart = api.startCount;

    await manager.startIntegration('twitch-auth');
    await settle();

    // Exactly one attempt: the failure drops it from the restart set, so the
    // ERROR it just reported cannot feed another reconcile pass.
    expect(api.startCount).toBe(beforeRestart + 1);
    expect(api.getStatus()).toBe(IntegrationStatus.ERROR);

    // A later, separate cascade is a new event and earns one new attempt —
    // bounded by real status changes rather than by the reconciler itself.
    auth.errorOut();
    await settle();
    await manager.startIntegration('twitch-auth');
    await settle();

    expect(api.startCount).toBe(beforeRestart + 2);
  });

  it('blocks a BLOCK-policy dependent instead of stopping it', async () => {
    const manager = makeManager(makeStateRepo(['twitch-auth', 'twitch-api']));
    api.policy = DependencyFailurePolicy.BLOCK;
    registerTwitchTrio(manager);
    await startAll();

    auth.failReauth();
    await settle();

    // Left running, so nothing it holds unrelated to auth is discarded.
    expect(api.stopped).toBe(false);
    expect(api.getStatus()).toBe(IntegrationStatus.BLOCKED);
    expect(api.getErrorMessage()).toContain('twitch-auth');

    // The listener downstream of it still tears down: it owns a connection
    // established under conditions that may no longer hold.
    expect(eventsub.stopped).toBe(true);
  });

  it('recovers a blocked dependent when the dependency returns', async () => {
    const manager = makeManager(makeStateRepo(['twitch-auth', 'twitch-api', 'twitch-eventsub']));
    api.policy = DependencyFailurePolicy.BLOCK;
    registerTwitchTrio(manager);
    await startAll();

    auth.failReauth();
    await settle();
    expect(api.getStatus()).toBe(IntegrationStatus.BLOCKED);

    await manager.startIntegration('twitch-auth');
    await settle();

    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
    // And the stopped listener comes back behind it, in dependency order.
    expect(eventsub.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('defaults to stopping a dependent that declares no policy', async () => {
    const manager = makeManager(makeStateRepo());
    registerTwitchTrio(manager);
    await startAll();

    expect(api.dependencyFailurePolicy).toBe(DependencyFailurePolicy.STOP);

    auth.failReauth();
    await settle();

    expect(api.stopped).toBe(true);
  });

  it('forwards a token refresh without changing status or cascading', async () => {
    const bus = new EventBus(new Logger({ level: 'silent' }));
    const refreshed = vi.fn();
    bus.on('integration.tokenRefreshed', refreshed);

    const manager = new IntegrationManager(
      makeStateRepo(['twitch-auth', 'twitch-api', 'twitch-eventsub']),
      bus,
      new Logger({ level: 'silent' })
    );
    registerTwitchTrio(manager);
    await startAll();

    const expiresAt = Date.now() + 3600_000;
    auth.refreshToken(expiresAt);
    await settle();

    expect(refreshed).toHaveBeenCalledWith({ name: 'twitch-auth', expiresAt });

    // A rotation is not a status change, so nothing downstream reacts: the
    // dependents stay up and carry on using the rotated credentials.
    expect(auth.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(api.stopped).toBe(false);
    expect(eventsub.stopped).toBe(false);
    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(eventsub.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('omits expiry from a refresh notification when it is unknown', async () => {
    const bus = new EventBus(new Logger({ level: 'silent' }));
    const refreshed = vi.fn();
    bus.on('integration.tokenRefreshed', refreshed);

    const manager = new IntegrationManager(
      makeStateRepo(['twitch-auth']),
      bus,
      new Logger({ level: 'silent' })
    );
    manager.register(auth);

    auth.refreshToken();
    await settle();

    expect(refreshed).toHaveBeenCalledWith({ name: 'twitch-auth' });
  });

  it('reports an unmet dependency as BLOCKED rather than ERROR', async () => {
    const manager = makeManager(makeStateRepo(['twitch-api']));
    registerTwitchTrio(manager);

    await expect(manager.startIntegration('twitch-api')).rejects.toThrow(/not connected/);

    expect(api.getStatus()).toBe(IntegrationStatus.BLOCKED);
    expect(api.getErrorMessage()).toContain('twitch-auth');
  });

  it('rejects an unregistered dependency when the graph is validated', () => {
    const manager = makeManager(makeStateRepo());
    manager.register(api); // twitch-auth deliberately not registered

    expect(() => manager.validateDependencies()).toThrow(/not registered/);
  });

  it('exposes dependencies as names on the wire', () => {
    const manager = makeManager(makeStateRepo());
    registerTwitchTrio(manager);

    expect(manager.getStatus('twitch-eventsub')?.metadata?.dependencies).toEqual([
      'twitch-auth',
      'twitch-api',
    ]);
  });
});
