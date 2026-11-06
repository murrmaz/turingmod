import 'reflect-metadata';
import { TRPC_PATH } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { Application } from './Application.js';
import type { ServiceLifecycle } from './core/ServiceLifecycle.js';
import type { DatabaseManager } from './database/DatabaseManager.js';
import type { IntegrationManager } from './integrations/IntegrationManager.js';
import type { HttpServer } from './server/HttpServer.js';
import type { TrpcServer } from './server/trpc/TrpcServer.js';
import { fake } from './testing.js';
import { Logger } from './utils/Logger.js';

/** An application whose parts record when each step begins and ends, in `steps`. */
function recordingApp() {
  const steps: string[] = [];
  /**
   * Takes a turn of the event loop, so the next step overlaps it unless this one is awaited, and
   * resolves to `result`.
   */
  const step = <T = void>(name: string, result?: T) =>
    vi.fn(async (): Promise<T> => {
      steps.push(`${name} begins`);
      await new Promise((resolve) => setImmediate(resolve));
      steps.push(`${name} ends`);
      return result as T;
    });
  const instant = (name: string) =>
    vi.fn(() => {
      steps.push(name);
    });

  const logger = new Logger({ level: 'silent' });
  const httpServer = {
    start: step('http start', 8080), // the port it bound
    stop: step('http stop'),
    routeUpgrades: instant('route upgrades'),
  };
  const trpcServer = { start: instant('trpc start'), stop: step('trpc stop') };
  const app = new Application(
    fake<DatabaseManager>()({ close: step('database close') }),
    fake<HttpServer>()(httpServer),
    fake<TrpcServer>()(trpcServer),
    fake<IntegrationManager>()({
      loadIntegrations: step('integrations load'),
      startEnabledIntegrations: step('integrations start'),
      stopAll: step('integrations stop'),
    }),
    fake<ServiceLifecycle>()({
      startAll: step('services start'),
      stopAll: step('services stop'),
    }),
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

  it('loads integrations first, and starts services before integrations connect', async () => {
    const { app, steps } = recordingApp();

    await app.start();

    expect(steps).toEqual([
      'integrations load begins',
      'integrations load ends',
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

  it('finishes a start in progress before stopping', async () => {
    const { app, steps } = recordingApp();

    const starting = app.start();
    await app.stop();
    await starting;

    expect(steps.indexOf('integrations start ends')).toBeLessThan(
      steps.indexOf('services stop begins')
    );
  });

  it('still stops what a failed start got going', async () => {
    const { app, steps, httpServer } = recordingApp();
    httpServer.start.mockRejectedValueOnce(new Error('port in use'));

    const starting = app.start();
    await app.stop();

    await expect(starting).rejects.toThrow('port in use');
    expect(steps).toContain('trpc stop ends');
    expect(steps).toContain('database close ends');
  });
});
