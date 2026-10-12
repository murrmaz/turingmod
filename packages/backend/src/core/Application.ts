import {
  createIntegrationStatusMessage,
  createOAuthCodeReceivedMessage,
  createYouTubeChatStateMessage,
} from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { IntegrationManager } from '../integrations/IntegrationManager.js';
import { HttpServer } from '../server/HttpServer.js';
import { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';
import { EventBus } from './EventBus.js';
import { ServiceLifecycle } from './ServiceLifecycle.js';

/**
 * Main application class
 * Orchestrates initialization, startup, and shutdown of all components
 */
@injectable()
@singleton()
export class Application {
  private logger: Logger;

  constructor(
    private databaseManager: DatabaseManager,
    private httpServer: HttpServer,
    private webSocketServer: WebSocketServer,
    private integrationManager: IntegrationManager,
    private eventBus: EventBus,
    private services: ServiceLifecycle,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'Application' });
  }

  /**
   * Initialize the application
   * Loads integrations from the database (already initialized/migrated in index.ts, ahead of
   * component registration, since the Encryption singleton needs its salt row to exist before
   * anything that depends on it — e.g. IntegrationStateRepository — is first resolved)
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing TuringMod...');

    this.logger.info('Loading integrations');
    await this.integrationManager.loadIntegrations();

    this.logger.info('TuringMod initialized successfully');
  }

  /**
   * Start the application
   * Starts all servers and enabled integrations
   */
  async start(): Promise<void> {
    this.logger.info('Starting TuringMod...');

    // 1. Start HTTP server
    await this.httpServer.start();

    // 2. Attach WebSocket server to HTTP server
    this.webSocketServer.start(this.httpServer.getServer());

    // 3. Start feature services, before integrations so they see what connecting changes
    await this.services.startAll();

    // 4. Start enabled integrations
    this.logger.info('Starting enabled integrations');
    await this.integrationManager.startEnabledIntegrations();

    // 5. Set up global event handlers
    this.setupEventHandlers();

    this.logger.info('TuringMod started successfully! 🚀');
  }

  /**
   * Set up global event handlers
   */
  private setupEventHandlers(): void {
    // Integration status changes
    this.eventBus.on('integration.status', (data) => {
      this.logger.debug('Integration status changed', data);

      // Get full integration info with metadata from IntegrationManager
      const integrationInfo = this.integrationManager.getStatus(data.name);

      if (integrationInfo) {
        // Broadcast complete status to all WebSocket clients (using protocol contract)
        this.webSocketServer.broadcast(createIntegrationStatusMessage(integrationInfo));
      }
    });

    // YouTube chat lifecycle: idle → resolving → streaming. Broadcast so the console's go-live
    // control shows whether chat actually connected, not just that the request was accepted.
    this.eventBus.on('youtube.chat.state', (data) => {
      this.logger.info('YouTube chat state changed', data);
      this.webSocketServer.broadcast(createYouTubeChatStateMessage(data.state));
    });

    // Integration errors
    this.eventBus.on('integration.error', (data) => {
      this.logger.error('Integration error', data.error, { name: data.name });
    });

    // OAuth callback received: deliver the code only to the client that
    // started this flow (correlated via the `state` value), never broadcast
    // it — any other connected client could otherwise redeem it first.
    this.eventBus.on('oauth.callback', (data) => {
      this.logger.info('OAuth callback received, notifying originating client', {
        integrationName: data.integrationName,
        clientId: data.clientId,
      });

      this.webSocketServer.sendToClient(
        data.clientId,
        createOAuthCodeReceivedMessage(data.integrationName, data.code)
      );
    });
  }

  /**
   * Stop the application gracefully
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping TuringMod...');

    // 1. Stop feature services while integrations are still connected: chat and redemptions
    //    stop first, then any facecam effect is cut short and any break ended, so shutting down
    //    mid-effect or mid-break doesn't leave the facecam spinning, or the streamer hidden and
    //    muted.
    await this.services.stopAll();

    // 2. Stop integrations
    await this.integrationManager.stopAll();

    // 3. Stop WebSocket server
    await this.webSocketServer.stop();

    // 4. Stop HTTP server
    await this.httpServer.stop();

    // 5. Close database
    await this.databaseManager.close();

    this.logger.info('TuringMod stopped successfully');
  }
}
