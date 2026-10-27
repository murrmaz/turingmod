import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

  override getDependencies(): IIntegration[] {
    return this.dependencies;
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

/** A fake with a config: `{ url }`, which it records so a test can see what it runs on. */
class ConfiguredFake extends FakeIntegration {
  url: string | null = null;
  startedWith: Array<string | null> = [];

  override initialize(stored: unknown): Promise<void> {
    this.url = this.parseConfig(z.strictObject({ url: z.string() }), stored).url;
    return Promise.resolve();
  }

  override start(): Promise<void> {
    this.startedWith.push(this.url);
    return super.start();
  }
}

interface FakeRepo extends IntegrationStateRepository {
  enabled: Set<string>;
}

function makeStateRepo(enabled: string[] = []): FakeRepo {
  const enabledSet = new Set(enabled);
  return {
    enabled: enabledSet,
    saveConfig: vi.fn(),
    setEnabled: vi.fn((name: string, on: boolean) => {
      if (on) enabledSet.add(name);
      else enabledSet.delete(name);
    }),
    getDecryptedConfig: vi.fn().mockReturnValue(null),
    findByName: vi.fn((name: string) => ({ name, enabled: enabledSet.has(name) })),
    findAllEnabled: vi.fn(() => [...enabledSet].map((name) => ({ name, enabled: true }))),
  } as unknown as FakeRepo;
}

function makeManager(
  repo: IntegrationStateRepository,
  logger = new Logger({ level: 'silent' })
): IntegrationManager {
  return new IntegrationManager(repo, new EventBus(new Logger({ level: 'silent' })), logger);
}

/** A logger to hand the manager, and a spy on the info() of the child logger it makes. */
function spiedLogger() {
  const logger = new Logger({ level: 'silent' });
  const child = new Logger({ level: 'silent' });
  vi.spyOn(logger, 'child').mockReturnValue(child);
  return { logger, info: vi.spyOn(child, 'info') };
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

  it('logs a token refresh without changing status or cascading', async () => {
    const { logger, info } = spiedLogger();
    const manager = makeManager(
      makeStateRepo(['twitch-auth', 'twitch-api', 'twitch-eventsub']),
      logger
    );
    registerTwitchTrio(manager);
    await startAll();

    const expiresAt = Date.now() + 3600_000;
    auth.refreshToken(expiresAt);
    await settle();

    expect(info).toHaveBeenCalledWith('OAuth token refreshed: twitch-auth', {
      expiresAt: new Date(expiresAt).toISOString(),
    });

    // A rotation is not a status change, so nothing downstream reacts: the
    // dependents stay up and carry on using the rotated credentials.
    expect(auth.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(api.stopped).toBe(false);
    expect(eventsub.stopped).toBe(false);
    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(eventsub.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('logs a refresh without an expiry when it is unknown', async () => {
    const { logger, info } = spiedLogger();
    const manager = makeManager(makeStateRepo(['twitch-auth']), logger);
    manager.register(auth);

    auth.refreshToken();
    await settle();

    expect(info).toHaveBeenCalledWith('OAuth token refreshed: twitch-auth', {});
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

    const eventsubInfo = manager.getAllStatuses().find((info) => info.name === 'twitch-eventsub');
    expect(eventsubInfo?.metadata?.dependencies).toEqual(['twitch-auth', 'twitch-api']);
  });
});

describe('IntegrationManager enabling', () => {
  let auth: FakeIntegration;
  let api: FakeIntegration;
  let repo: FakeRepo;
  let manager: IntegrationManager;

  beforeEach(() => {
    auth = new FakeIntegration('twitch-auth');
    api = new FakeIntegration('twitch-api', [auth]);
    repo = makeStateRepo();
    manager = makeManager(repo);
    manager.register(auth);
    manager.register(api);
  });

  it('remembers an integration started from the console and starts it', async () => {
    await manager.enableIntegration('twitch-auth');

    expect(repo.enabled.has('twitch-auth')).toBe(true);
    expect(auth.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('enables an integration whose dependency is down, and starts it once that connects', async () => {
    await manager.enableIntegration('twitch-api');

    expect(repo.enabled.has('twitch-api')).toBe(true);
    expect(api.getStatus()).toBe(IntegrationStatus.BLOCKED);

    await manager.enableIntegration('twitch-auth');
    await settle();

    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('starts enabled integrations at boot, including ones waiting on a dependency', async () => {
    repo.enabled.add('twitch-api');

    await manager.startEnabledIntegrations();
    expect(api.getStatus()).toBe(IntegrationStatus.BLOCKED);

    await auth.start();
    await settle();

    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('brings back an integration started from the console after its dependency recovers', async () => {
    await manager.enableIntegration('twitch-auth');
    await manager.enableIntegration('twitch-api');

    auth.failReauth();
    await settle();
    auth.reportConnected();
    await settle();

    expect(api.startCount).toBe(2);
    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('leaves an integration stopped from the console down when its dependency recovers', async () => {
    await manager.enableIntegration('twitch-auth');
    await manager.enableIntegration('twitch-api');

    await manager.disableIntegration('twitch-api');
    auth.failReauth();
    await settle();
    auth.reportConnected();
    await settle();

    expect(repo.enabled.has('twitch-api')).toBe(false);
    expect(api.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
    expect(api.startCount).toBe(1);
  });
});

describe('IntegrationManager configs', () => {
  it('rejects a config that does not fit the schema without storing it', async () => {
    const repo = makeStateRepo();
    const manager = makeManager(repo);
    manager.register(new FakeIntegration('discord'));

    await expect(manager.configureIntegration('discord', { token: 'abc' })).rejects.toThrow(
      /Invalid discord config/
    );
    expect(repo.saveConfig).not.toHaveBeenCalled();
  });

  it('restarts an enabled integration on its new config, leaving it enabled', async () => {
    const repo = makeStateRepo(['obs']);
    const manager = makeManager(repo);
    const obs = new ConfiguredFake('obs');
    manager.register(obs);
    await obs.initialize({ url: 'ws://old' });
    await manager.startIntegration('obs');

    await manager.configureIntegration('obs', { url: 'ws://new' });

    expect(obs.startedWith).toEqual(['ws://old', 'ws://new']);
    expect(repo.saveConfig).toHaveBeenCalledWith('obs', { url: 'ws://new' });
    expect(repo.setEnabled).not.toHaveBeenCalled();
  });

  it('only stores the config of an integration that is not enabled', async () => {
    const repo = makeStateRepo();
    const manager = makeManager(repo);
    const obs = new ConfiguredFake('obs');
    manager.register(obs);

    await manager.configureIntegration('obs', { url: 'ws://new' });

    expect(obs.url).toBe('ws://new');
    expect(obs.startCount).toBe(0);
  });

  it('reports a stored config that does not fit the schema as the integration error', async () => {
    const repo = makeStateRepo();
    Object.assign(repo, {
      findAll: vi.fn().mockReturnValue([{ name: 'discord', config: 'encrypted' }]),
      getDecryptedConfig: vi.fn().mockReturnValue({ token: 'abc' }),
    });
    const manager = makeManager(repo);
    const discord = new FakeIntegration('discord');
    manager.register(discord);

    await manager.loadIntegrations();

    expect(discord.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(discord.getErrorMessage()).toMatch(/Invalid discord config[\s\S]*token/);
  });

  it('refuses to start on a stored config that failed to load, until it is given one that fits', async () => {
    const repo = makeStateRepo(['obs']);
    Object.assign(repo, {
      findAll: vi.fn().mockReturnValue([{ name: 'obs', config: 'encrypted' }]),
      getDecryptedConfig: vi.fn().mockReturnValue({ url: 42 }),
    });
    const manager = makeManager(repo);
    const obs = new ConfiguredFake('obs');
    manager.register(obs);
    await manager.loadIntegrations();

    await expect(manager.startIntegration('obs')).rejects.toThrow(/Invalid obs config/);
    expect(obs.startCount).toBe(0);

    await manager.configureIntegration('obs', { url: 'ws://fixed' });

    expect(obs.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(obs.startedWith).toEqual(['ws://fixed']);
  });
});
