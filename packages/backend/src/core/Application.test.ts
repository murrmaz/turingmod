import 'reflect-metadata';
import { TRPC_PATH } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import type { IntegrationManager } from '../integrations/IntegrationManager.js';
import type { HttpServer } from '../server/HttpServer.js';
import type { TrpcServer } from '../server/trpc/TrpcServer.js';
import { Logger } from '../utils/Logger.js';
import { Application } from './Application.js';
import { EventBus } from './EventBus.js';
import type { ServiceLifecycle } from './ServiceLifecycle.js';

/** An application whose parts record when each step begins and ends, in `steps`. */
function recordingApp() {
  const steps: string[] = [];
  /** Takes a turn of the event loop, so the next step overlaps it unless this one is awaited. */
  const step = (name: string) =>
    vi.fn(async () => {
      steps.push(`${name} begins`);
      await new Promise((resolve) => setImmediate(resolve));
      steps.push(`${name} ends`);
    });
  const instant = (name: string) =>
    vi.fn(() => {
      steps.push(name);
    });

  const logger = new Logger({ level: 'silent' });
  const httpServer = {
    start: step('http start'),
    stop: step('http stop'),
    routeUpgrades: instant('route upgrades'),
  };
  const trpcServer = { start: instant('trpc start'), stop: step('trpc stop') };
  const app = new Application(
    { close: step('database close') } as unknown as DatabaseManager,
    httpServer as unknown as HttpServer,
    trpcServer as unknown as TrpcServer,
    {
      startEnabledIntegrations: step('integrations start'),
      stopAll: step('integrations stop'),
    } as unknown as IntegrationManager,
    new EventBus(logger),
    {
      startAll: step('services start'),
      stopAll: step('services stop'),
    } as unknown as ServiceLifecycle,
    logger
  );
  return { app, steps, httpServer, trpcServer };
}

describe('Application', () => {
  it('routes each WebSocket path to its endpoint before the HTTP server listens', async () => {
    const { app, httpServer, trpcServer } = recordingApp();

    await app.start();

    expect(httpServer.routeUpgrades).toHaveBeenCalledWith(TRPC_PATH, trpcServer);
    const lastRoute = Math.max(...httpServer.routeUpgrades.mock.invocationCallOrder);
    expect(lastRoute).toBeLessThan(httpServer.start.mock.invocationCallOrder[0] ?? 0);
  });

  it('starts services before integrations, so they see what connecting changes', async () => {
    const { app, steps } = recordingApp();

    await app.start();

    expect(steps).toEqual([
      'trpc start',
      'route upgrades',
      'http start begins',
      'http start ends',
      'services start begins',
      'services start ends',
      'integrations start begins',
      'integrations start ends',
    ]);
  });

  it('finishes each step of shutting down before the next, services first', async () => {
    const { app, steps } = recordingApp();

    await app.stop();

    // Services undo what they did through integrations (ending a break restores OBS) and write
    // to the database, so both have to outlast them.
    expect(steps).toEqual([
      'services stop begins',
      'services stop ends',
      'integrations stop begins',
      'integrations stop ends',
      'trpc stop begins',
      'trpc stop ends',
      'http stop begins',
      'http stop ends',
      'database close begins',
      'database close ends',
    ]);
  });
});
