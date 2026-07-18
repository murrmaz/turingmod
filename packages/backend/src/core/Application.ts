import {
  createIntegrationStatusMessage,
  createOAuthCodeReceivedMessage,
  type IntegrationStatus,
} from '@turingmod/shared';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import type { MigrationRunner } from '../database/migrations/MigrationRunner.js';
import type { IntegrationManager } from '../integrations/IntegrationManager.js';
import type { HttpServer } from '../server/HttpServer.js';
import type { WebSocketServer } from '../server/WebSocketServer.js';
import type { Logger } from '../utils/Logger.js';
import type { EventBus } from './EventBus.js';

/**
 * Main application class
 * Orchestrates initialization, startup, and shutdown of all components
 */
export class Application {
  private logger: Logger;

  constructor(
    private databaseManager: DatabaseManager,
    private migrationRunner: MigrationRunner,
    private httpServer: HttpServer,
    private webSocketServer: WebSocketServer,
    private integrationManager: IntegrationManager,
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'Application' });
  }

  /**
   * Initialize the application
   * Sets up database and loads configuration
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing TuringMod...');

    // 1. Initialize database
    this.logger.info('Initializing database');
    await this.databaseManager.initialize();

    // 2. Run migrations
    this.logger.info('Running database migrations');
    const { initialSchema } = await import('../database/migrations/001_initial_schema.js');
    await this.migrationRunner.runMigrations([initialSchema]);

    // 3. Load integrations from database
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

    // 3. Start enabled integrations
    this.logger.info('Starting enabled integrations');
    await this.integrationManager.startEnabledIntegrations();

    // 4. Set up global event handlers
    this.setupEventHandlers();

    this.logger.info('TuringMod started successfully! 🚀');
  }

  /**
   * Set up global event handlers
   */
  private setupEventHandlers(): void {
    // Integration status changes
    this.eventBus.on<{ name: string; status: IntegrationStatus; lastConnected?: number }>(
      'integration:status',
      (data) => {
        this.logger.info('Integration status changed', data);

        // Get full integration info with metadata from IntegrationManager
        const integrationInfo = this.integrationManager.getStatus(data.name);

        if (integrationInfo) {
          // Broadcast complete status to all WebSocket clients (using protocol contract)
          this.webSocketServer.broadcast(createIntegrationStatusMessage(integrationInfo));
        }
      }
    );

    // Integration errors
    this.eventBus.on<{ name: string; error: Error }>('integration:error', (data) => {
      this.logger.error('Integration error', data.error, { name: data.name });
    });

    // OAuth callback received (broadcast to all WebSocket clients)
    this.eventBus.on('oauth:callback', (data: { integrationName: string; code: string }) => {
      this.logger.info('OAuth callback received, broadcasting to clients', {
        integrationName: data.integrationName,
      });

      // Broadcast code to all WebSocket clients
      this.webSocketServer.broadcast(
        createOAuthCodeReceivedMessage(data.integrationName, data.code)
      );
    });
  }

  /**
   * Stop the application gracefully
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping TuringMod...');

    // 1. Stop integrations
    await this.integrationManager.stopAll();

    // 2. Stop WebSocket server
    await this.webSocketServer.stop();

    // 3. Stop HTTP server
    await this.httpServer.stop();

    // 4. Close database
    await this.databaseManager.close();

    this.logger.info('TuringMod stopped successfully');
  }
}
