import {
  type ActivityQueryPayload,
  type CommandExecutePayload,
  type CommandListRequestPayload,
  type CommandSimulatePayload,
  DEFAULT_FRONTEND_DEV_PORT,
  type IntegrationConfigurePayload,
  type IntegrationStartPayload,
  type IntegrationStopPayload,
  type IWebSocketMessage,
  MessageType,
  type OAuthExchangeCodePayload,
  type OAuthGetAuthUrlPayload,
  type YouTubeChatControlPayload,
} from '@turingmod/shared';
import { container, instanceCachingFactory } from 'tsyringe';
import { ActivityForwarder } from './activity/ActivityForwarder.js';
import { AdWarningScheduler } from './breaks/AdWarningScheduler.js';
import { BreakService } from './breaks/BreakService.js';
import { CommandRegistry } from './commands/CommandRegistry.js';
import { loadCommands } from './commands/loadCommands.js';
import { EventBus } from './core/EventBus.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { MigrationRunner } from './database/migrations/MigrationRunner.js';
import { IntegrationManager } from './integrations/IntegrationManager.js';
import { ArduinoIntegration } from './integrations/implementations/arduino/ArduinoIntegration.js';
import { DiscordIntegration } from './integrations/implementations/discord/DiscordIntegration.js';
import { ObsIntegration } from './integrations/implementations/obs/ObsIntegration.js';
import { SoundIntegration } from './integrations/implementations/sound/SoundIntegration.js';
import { SpotifyApiIntegration } from './integrations/implementations/spotify/SpotifyApiIntegration.js';
import { SpotifyAuthIntegration } from './integrations/implementations/spotify/SpotifyAuthIntegration.js';
import { TwitchApiIntegration } from './integrations/implementations/twitch/TwitchApiIntegration.js';
import { TwitchAuthIntegration } from './integrations/implementations/twitch/TwitchAuthIntegration.js';
import { TwitchEventSubIntegration } from './integrations/implementations/twitch/TwitchEventSubIntegration.js';
import { YouTubeApiIntegration } from './integrations/implementations/youtube/YouTubeApiIntegration.js';
import { YouTubeAuthIntegration } from './integrations/implementations/youtube/YouTubeAuthIntegration.js';
import { YouTubeChatIntegration } from './integrations/implementations/youtube/YouTubeChatIntegration.js';
import { ChatRouter } from './platforms/ChatRouter.js';
import { PlatformRegistry } from './platforms/PlatformRegistry.js';
import { TwitchPlatform } from './platforms/TwitchPlatform.js';
import { YouTubePlatform } from './platforms/YouTubePlatform.js';
import { HttpServer } from './server/HttpServer.js';
import { ActivityHandler } from './server/handlers/ActivityHandler.js';
import { CommandHandler } from './server/handlers/CommandHandler.js';
import { IntegrationHandler } from './server/handlers/IntegrationHandler.js';
import { OAuthHandler } from './server/handlers/OAuthHandler.js';
import { YouTubeHandler } from './server/handlers/YouTubeHandler.js';
import { MessageRouter } from './server/MessageRouter.js';
import { WebSocketServer } from './server/WebSocketServer.js';
import { TuringModConfig } from './utils/Config.js';
import { Encryption } from './utils/Encryption.js';
import { Logger } from './utils/Logger.js';

/**
 * Register the handful of classes tsyringe can't auto-construct from decorated constructor
 * parameters alone, because their constructors take primitives/derived values (a log level, a
 * db path, a master password + salt, an allowed-origins list) rather than other injectable
 * classes. Everything else is wired implicitly via @injectable()/@singleton() on the class
 * itself — this is deliberately the only "wiring" code left; it replaces what used to be a
 * 554-line registerSingleton call per service.
 *
 * instanceCachingFactory makes each factory lazy-once, matching the old Container's singleton
 * semantics — in particular, Encryption's factory must not run until after the database has been
 * initialized and migrated (see initializeDatabase below), since it reads a DB-stored salt.
 */
export function registerRootFactories(): void {
  container.register(Logger, {
    useFactory: instanceCachingFactory((c) => {
      const config = c.resolve(TuringModConfig);
      return new Logger({ level: config.logLevel, pretty: true });
    }),
  });

  container.register(DatabaseManager, {
    useFactory: instanceCachingFactory((c) => {
      const config = c.resolve(TuringModConfig);
      return new DatabaseManager(config.dbPath, c.resolve(Logger));
    }),
  });

  container.register(Encryption, {
    useFactory: instanceCachingFactory((c) => {
      const config = c.resolve(TuringModConfig);
      const salt = Encryption.getOrCreateSalt(c.resolve(DatabaseManager));
      return new Encryption(config.masterPassword, salt);
    }),
  });

  container.register(HttpServer, {
    useFactory: instanceCachingFactory((c) => {
      const config = c.resolve(TuringModConfig);
      return new HttpServer(
        config.wsPort,
        config.host,
        config.frontendDistPath,
        c.resolve(EventBus),
        c.resolve(IntegrationManager),
        c.resolve(Logger)
      );
    }),
  });

  container.register(WebSocketServer, {
    useFactory: instanceCachingFactory((c) => {
      const config = c.resolve(TuringModConfig);
      // Same-origin production origin plus the Vite dev server origin (always
      // bound to 127.0.0.1 per vite.config.ts, regardless of backend HOST) —
      // the only two pages ever allowed to open a WS connection to us.
      const allowedOrigins = [
        `http://${config.host}:${config.wsPort}`,
        `http://127.0.0.1:${DEFAULT_FRONTEND_DEV_PORT}`,
      ];
      return new WebSocketServer(c.resolve(MessageRouter), allowedOrigins, c.resolve(Logger));
    }),
  });
}

/**
 * Open the database and run migrations. Must run before anything resolves Encryption (pulled in
 * transitively by the OAuth integrations' auth classes), since its factory reads its salt from
 * the settings table and requires the schema to already exist.
 */
export async function initializeDatabase(): Promise<void> {
  const logger = container.resolve(Logger);

  logger.info('Initializing database');
  await container.resolve(DatabaseManager).initialize();

  logger.info('Running database migrations');
  const { initialSchema } = await import('./database/migrations/001_initial_schema.js');
  await container.resolve(MigrationRunner).runMigrations([initialSchema]);
}

/**
 * Initialize application components
 * Registers commands, integrations, and message handlers
 */
export async function initializeComponents(): Promise<void> {
  const logger = container.resolve(Logger);
  logger.info('Initializing components');

  // Auto-discover and register commands
  await loadCommands(container.resolve(CommandRegistry), logger);

  // Register integrations
  const integrationManager = container.resolve(IntegrationManager);

  // Register Twitch integrations (order matters: Auth → API → EventSub)
  integrationManager.register(container.resolve(TwitchAuthIntegration));
  integrationManager.register(container.resolve(TwitchApiIntegration));
  integrationManager.register(container.resolve(TwitchEventSubIntegration));

  // Register Spotify integrations (order matters: Auth → API)
  integrationManager.register(container.resolve(SpotifyAuthIntegration));
  integrationManager.register(container.resolve(SpotifyApiIntegration));

  // Register YouTube integrations (order matters: Auth → API → Chat)
  integrationManager.register(container.resolve(YouTubeAuthIntegration));
  integrationManager.register(container.resolve(YouTubeApiIntegration));
  integrationManager.register(container.resolve(YouTubeChatIntegration));

  // Register other integrations
  integrationManager.register(container.resolve(DiscordIntegration));
  integrationManager.register(container.resolve(ArduinoIntegration));
  integrationManager.register(container.resolve(ObsIntegration));
  integrationManager.register(container.resolve(SoundIntegration));

  // Everything is registered, so the whole dependency graph can be checked
  // now: a missing or circular dependency fails at boot rather than whenever
  // someone enables the integrations involved.
  integrationManager.validateDependencies();

  // Populate the platform provider registry (StreamingPlatform → IStreamPlatform)
  const platformRegistry = container.resolve(PlatformRegistry);
  platformRegistry.register(container.resolve(TwitchPlatform));
  platformRegistry.register(container.resolve(YouTubePlatform));

  // Construct the reply-routing seam and start the live chat→command→reply loop.
  container.resolve(ChatRouter).start();

  // Start forwarding EventBus activity to the live tail (broadcast) and activity_log (persist).
  container.resolve(ActivityForwarder).start();

  // Stream breaks: Twitch ad breaks (and !break) take the streamer off camera and mic, and chat
  // on every platform is warned ahead of scheduled ads. Stopped in Application.stop(), before
  // integrations, so a break in progress is restored while OBS is still connected.
  await container.resolve(BreakService).start();
  container.resolve(AdWarningScheduler).start();

  // Register message handlers
  const messageRouter = container.resolve(MessageRouter);
  const commandHandler = container.resolve(CommandHandler);
  const integrationHandler = container.resolve(IntegrationHandler);
  const oauthHandler = container.resolve(OAuthHandler);
  const activityHandler = container.resolve(ActivityHandler);
  const youtubeHandler = container.resolve(YouTubeHandler);

  messageRouter.registerHandler(MessageType.COMMAND_EXECUTE, (msg) =>
    commandHandler.handleExecute(msg as IWebSocketMessage<CommandExecutePayload>)
  );

  messageRouter.registerHandler(MessageType.COMMAND_SIMULATE, (msg) =>
    commandHandler.handleSimulate(msg as IWebSocketMessage<CommandSimulatePayload>)
  );

  messageRouter.registerHandler(MessageType.COMMAND_LIST, (msg) =>
    commandHandler.handleList(msg as IWebSocketMessage<CommandListRequestPayload>)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_START, (msg) =>
    integrationHandler.handleStart(msg as IWebSocketMessage<IntegrationStartPayload>)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_STOP, (msg) =>
    integrationHandler.handleStop(msg as IWebSocketMessage<IntegrationStopPayload>)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_LIST, (msg) =>
    integrationHandler.handleList(msg)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_CONFIGURE, (msg) =>
    integrationHandler.handleConfigure(msg as IWebSocketMessage<IntegrationConfigurePayload>)
  );

  messageRouter.registerHandler(MessageType.OAUTH_GET_AUTH_URL, (msg, clientId) =>
    oauthHandler.handleGetAuthUrl(msg as IWebSocketMessage<OAuthGetAuthUrlPayload>, clientId)
  );

  messageRouter.registerHandler(MessageType.OAUTH_EXCHANGE_CODE, (msg) =>
    oauthHandler.handleExchangeCode(msg as IWebSocketMessage<OAuthExchangeCodePayload>)
  );

  messageRouter.registerHandler(MessageType.ACTIVITY_QUERY, (msg) =>
    activityHandler.handleQuery(msg as IWebSocketMessage<ActivityQueryPayload>)
  );

  messageRouter.registerHandler(MessageType.YOUTUBE_GO_LIVE, (msg) =>
    youtubeHandler.handleGoLive(msg as IWebSocketMessage<YouTubeChatControlPayload>)
  );

  messageRouter.registerHandler(MessageType.YOUTUBE_GO_OFFLINE, (msg) =>
    youtubeHandler.handleGoOffline(msg as IWebSocketMessage<YouTubeChatControlPayload>)
  );

  messageRouter.registerHandler(MessageType.YOUTUBE_GET_CHAT_STATE, (msg) =>
    youtubeHandler.handleGetState(msg as IWebSocketMessage<YouTubeChatControlPayload>)
  );

  logger.info('Components initialized');
}
