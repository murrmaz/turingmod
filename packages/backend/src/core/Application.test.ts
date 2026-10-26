import 'reflect-metadata';
import { MessageType, TRPC_PATH, WS_PATH } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import type { IntegrationManager } from '../integrations/IntegrationManager.js';
import type { HttpServer } from '../server/HttpServer.js';
import type { TrpcServer } from '../server/trpc/TrpcServer.js';
import type { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';
import { Application } from './Application.js';
import { EventBus } from './EventBus.js';
import type { ServiceLifecycle } from './ServiceLifecycle.js';

function startableApp() {
  const logger = new Logger({ level: 'silent' });
  const eventBus = new EventBus(logger);
  const integrationManager = {
    // An authorization can finish while integrations are starting.
    startEnabledIntegrations: vi.fn(async () => {
      await eventBus.emit('oauth.completed', { integrationName: 'twitch-auth', success: true });
    }),
  } as unknown as IntegrationManager;
  const httpServer = { start: vi.fn(), routeUpgrades: vi.fn() };
  const webSocketServer = { start: vi.fn(), broadcast: vi.fn() };
  const trpcServer = { start: vi.fn() };
  const app = new Application(
    {} as DatabaseManager,
    httpServer as unknown as HttpServer,
    webSocketServer as unknown as WebSocketServer,
    trpcServer as unknown as TrpcServer,
    integrationManager,
    eventBus,
    { startAll: vi.fn() } as unknown as ServiceLifecycle,
    logger
  );
  return { app, httpServer, webSocketServer, trpcServer };
}

describe('Application', () => {
  it('forwards events that happen while integrations are starting up', async () => {
    const { app, webSocketServer } = startableApp();

    await app.start();

    expect(webSocketServer.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.OAUTH_RESULT,
        payload: { integrationName: 'twitch-auth', success: true },
      })
    );
  });

  it('routes each WebSocket path to its endpoint before the HTTP server listens', async () => {
    const { app, httpServer, webSocketServer, trpcServer } = startableApp();

    await app.start();

    expect(httpServer.routeUpgrades).toHaveBeenCalledWith(WS_PATH, webSocketServer);
    expect(httpServer.routeUpgrades).toHaveBeenCalledWith(TRPC_PATH, trpcServer);
    const lastRoute = Math.max(...httpServer.routeUpgrades.mock.invocationCallOrder);
    expect(lastRoute).toBeLessThan(httpServer.start.mock.invocationCallOrder[0] ?? 0);
  });
});
