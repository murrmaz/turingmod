import { IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import { Logger } from '../utils/Logger.js';
import { BaseIntegration } from './BaseIntegration.js';
import { IntegrationManager } from './IntegrationManager.js';

class FakeIntegration extends BaseIntegration {
  readonly version = '1.0.0';
  stopped = false;

  constructor(
    readonly name: string,
    private dependencies: string[] = []
  ) {
    super(new Logger({ level: 'silent' }), { component: name });
  }

  getDependencies(): string[] {
    return this.dependencies;
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.setStatus(IntegrationStatus.CONNECTED);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }

  /** Simulate a downstream failure like a dead Twitch refresh token. */
  fail(): void {
    this.setStatus(IntegrationStatus.NEEDS_REAUTH, 'needs reauth');
  }

  /** Simulate an unrelated, non-reauth status transition. */
  errorOut(): void {
    this.setStatus(IntegrationStatus.ERROR, 'transient error');
  }
}

function makeStateRepo(): IntegrationStateRepository {
  return {
    updateStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as IntegrationStateRepository;
}

// Give the fire-and-forget stopDependents() call (kicked off from a sync
// EventEmitter callback) a turn to run before assertions.
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('IntegrationManager', () => {
  it('stops transitive dependents when a dependency needs re-authorization', async () => {
    const manager = new IntegrationManager(
      makeStateRepo(),
      new EventBus(new Logger({ level: 'silent' }), { component: 'EventBus' }),
      new Logger({ level: 'silent' })
    );

    const auth = new FakeIntegration('twitch-auth');
    const api = new FakeIntegration('twitch-api', ['twitch-auth']);
    const eventsub = new FakeIntegration('twitch-eventsub', ['twitch-auth', 'twitch-api']);
    const unrelated = new FakeIntegration('discord');

    manager.register(auth);
    manager.register(api);
    manager.register(eventsub);
    manager.register(unrelated);

    await auth.start();
    await api.start();
    await eventsub.start();
    await unrelated.start();

    auth.fail();
    await flush();

    expect(api.stopped).toBe(true);
    expect(eventsub.stopped).toBe(true);
    expect(api.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
    expect(eventsub.getStatus()).toBe(IntegrationStatus.DISCONNECTED);

    // The failed integration itself and unrelated integrations are untouched.
    expect(auth.getStatus()).toBe(IntegrationStatus.NEEDS_REAUTH);
    expect(unrelated.stopped).toBe(false);
  });

  it('does not cascade for status transitions other than NEEDS_REAUTH', async () => {
    const manager = new IntegrationManager(
      makeStateRepo(),
      new EventBus(new Logger({ level: 'silent' }), { component: 'EventBus' }),
      new Logger({ level: 'silent' })
    );

    const auth = new FakeIntegration('twitch-auth');
    const api = new FakeIntegration('twitch-api', ['twitch-auth']);

    manager.register(auth);
    manager.register(api);

    await auth.start();
    await api.start();

    auth.errorOut();
    await flush();

    expect(api.stopped).toBe(false);
    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });
});
