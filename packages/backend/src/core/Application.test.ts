import 'reflect-metadata';
import { type IntegrationInfo, IntegrationStatus, MessageType } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import type { IntegrationManager } from '../integrations/IntegrationManager.js';
import type { HttpServer } from '../server/HttpServer.js';
import type { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';
import { Application } from './Application.js';
import { EventBus } from './EventBus.js';
import type { ServiceLifecycle } from './ServiceLifecycle.js';

describe('Application', () => {
  it('forwards status changes that integrations make while starting up', async () => {
    const logger = new Logger({ level: 'silent' });
    const eventBus = new EventBus(logger);
    const info: IntegrationInfo = {
      name: 'obs',
      status: IntegrationStatus.CONNECTED,
      enabled: true,
      placeholder: false,
      metadata: { dependencies: [] },
    };
    const integrationManager = {
      // Connecting reports a status change, as a real integration does.
      startEnabledIntegrations: vi.fn(async () => {
        await eventBus.emit('integration.status', { name: 'obs', status: info.status });
      }),
      getStatus: () => info,
    } as unknown as IntegrationManager;
    const webSocketServer = {
      start: vi.fn(),
      broadcast: vi.fn(),
    } as unknown as WebSocketServer;
    const app = new Application(
      {} as DatabaseManager,
      { start: vi.fn(), getServer: vi.fn() } as unknown as HttpServer,
      webSocketServer,
      integrationManager,
      eventBus,
      { startAll: vi.fn() } as unknown as ServiceLifecycle,
      logger
    );

    await app.start();

    expect(webSocketServer.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INTEGRATION_STATUS,
        payload: { integration: info },
      })
    );
  });
});
