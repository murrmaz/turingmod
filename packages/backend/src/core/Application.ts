import {
  createOAuthResultMessage,
  createYouTubeChatStateMessage,
  TRPC_PATH,
  WS_PATH,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { IntegrationManager } from '../integrations/IntegrationManager.js';
import { HttpServer } from '../server/HttpServer.js';
import { TrpcServer } from '../server/trpc/TrpcServer.js';
import { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';
import { EventBus } from './EventBus.js';
import { ServiceLifecycle } from './ServiceLifecycle.js';

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
    private webSocketServer: WebSocketServer,
    private trpcServer: TrpcServer,
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

    // 1. Forward events to the console before anything can emit them: a console left open
    //    across a restart reconnects as soon as the HTTP server is up.
    this.setupEventHandlers();

    // 2. Start the WebSocket endpoints, then the HTTP server that hands them their upgrades
    this.webSocketServer.start();
    this.trpcServer.start();
    this.httpServer.routeUpgrades(WS_PATH, this.webSocketServer);
    this.httpServer.routeUpgrades(TRPC_PATH, this.trpcServer);
    await this.httpServer.start();

    // 3. Start feature services, before integrations so they see what connecting changes
    await this.services.startAll();

    // 4. Start enabled integrations
    this.logger.info('Starting enabled integrations');
    await this.integrationManager.startEnabledIntegrations();

    this.logger.info('TuringMod started successfully! 🚀');
  }

  /**
   * Set up global event handlers
   */
  private setupEventHandlers(): void {
    // Integration status changes reach the console through the `integrations.watch`
    // subscription (server/trpc/integrationsRouter.ts).

    // YouTube chat lifecycle: idle → resolving → streaming. Broadcast so the console's go-live
    // control shows whether chat actually connected, not just that the request was accepted.
    this.eventBus.on('youtube.chat.state', (data) => {
      this.logger.info('YouTube chat state changed', data);
      this.webSocketServer.broadcast(createYouTubeChatStateMessage(data.state));
    });

    // An authorization finished. The backend exchanged the code itself, so the result carries
    // none and goes to every console: whichever one asked may have reconnected or closed since.
    this.eventBus.on('oauth.completed', (data) => {
      this.webSocketServer.broadcast(
        createOAuthResultMessage(data.integrationName, data.success, data.errorMessage)
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

    // 3. Stop the WebSocket endpoints
    await Promise.all([this.webSocketServer.stop(), this.trpcServer.stop()]);

    // 4. Stop HTTP server
    await this.httpServer.stop();

    // 5. Close database
    await this.databaseManager.close();

    this.logger.info('TuringMod stopped successfully');
  }
}
