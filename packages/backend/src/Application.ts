import { TRPC_PATH } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { ServiceLifecycle } from './core/ServiceLifecycle.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { IntegrationManager } from './integrations/IntegrationManager.js';
import { HttpServer } from './server/HttpServer.js';
import { TrpcServer } from './server/trpc/TrpcServer.js';
import { Logger } from './utils/Logger.js';

/**
 * Main application class
 * Orchestrates initialization, startup, and shutdown of all components
 */
@singleton()
export class Application {
  private logger: Logger;

  constructor(
    private databaseManager: DatabaseManager,
    private httpServer: HttpServer,
    private trpcServer: TrpcServer,
    private integrationManager: IntegrationManager,
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

    // 1. Start the console's endpoint, then the HTTP server that hands it its upgrades
    this.trpcServer.start();
    this.httpServer.routeUpgrades(TRPC_PATH, this.trpcServer);
    await this.httpServer.start();

    // 2. Start feature services, before integrations so they see what connecting changes
    await this.services.startAll();

    // 3. Start enabled integrations
    this.logger.info('Starting enabled integrations');
    await this.integrationManager.startEnabledIntegrations();

    this.logger.info('TuringMod started successfully! 🚀');
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

    // 3. Stop the console's endpoint
    await this.trpcServer.stop();

    // 4. Stop HTTP server
    await this.httpServer.stop();

    // 5. Close database
    await this.databaseManager.close();

    this.logger.info('TuringMod stopped successfully');
  }
}
