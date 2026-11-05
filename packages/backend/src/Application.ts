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
 * Orchestrates startup and shutdown of all components
 */
@singleton()
export class Application {
  private logger: Logger;
  private starting: Promise<void> = Promise.resolve();

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
   * Start the application: apply stored integration configs, then start the servers, feature
   * services and enabled integrations.
   */
  start(): Promise<void> {
    this.starting = this.startInOrder();
    return this.starting;
  }

  private async startInOrder(): Promise<void> {
    this.logger.info('Starting TuringMod...');

    await this.integrationManager.loadIntegrations();

    // 1. Start the console's endpoint, then the HTTP server that hands it its upgrades
    this.trpcServer.start();
    this.httpServer.routeUpgrades(TRPC_PATH, this.trpcServer);
    await this.httpServer.start();

    // 2. Start feature services, before integrations so they see what connecting changes
    await this.services.startAll();

    // 3. Start enabled integrations
    await this.integrationManager.startEnabledIntegrations();

    this.logger.info('TuringMod started successfully! 🚀');
  }

  /**
   * Stop the application gracefully. A start still in progress finishes first, whether it succeeds
   * or not, so that everything it started gets stopped; stopping halfway through could leave a
   * break or effect half applied.
   */
  async stop(): Promise<void> {
    await this.starting.catch(() => undefined);

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
