import { DEFAULT_FRONTEND_DEV_PORT, MessageType } from '@turingmod/shared';
import { container, instanceCachingFactory } from 'tsyringe';
import { ActivityForwarder } from './activity/ActivityForwarder.js';
import { AdWarningScheduler } from './breaks/AdWarningScheduler.js';
import { BreakService } from './breaks/BreakService.js';
import { BREAK_SETTINGS } from './breaks/breakSettings.js';
import { IntervalAnnouncer } from './chat/announcements/IntervalAnnouncer.js';
import { ChatRouter } from './chat/ChatRouter.js';
import { ClipCollector } from './chat/clips/ClipCollector.js';
import { LurkTracker } from './chat/lurk/LurkTracker.js';
import { OwnChatMessages } from './chat/OwnChatMessages.js';
import { CommandRegistry } from './commands/CommandRegistry.js';
import { loadCommands } from './commands/loadCommands.js';
import { ServiceLifecycle } from './core/ServiceLifecycle.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { DataInspector } from './database/DataInspector.js';
import { MigrationRunner } from './database/migrations/MigrationRunner.js';
import {
  type SettingsDefinition,
  SettingsRepository,
} from './database/repositories/SettingsRepository.js';
import { EFFECT_SETTINGS } from './effects/effectSettings.js';
import { FacecamEffectRunner } from './effects/FacecamEffectRunner.js';
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
import { OAuthFlowService } from './integrations/OAuthFlowService.js';
import { GoLiveAnnouncer } from './live/GoLiveAnnouncer.js';
import { ObsStreamState } from './live/ObsStreamState.js';
import { PlatformLiveStatus } from './live/PlatformLiveStatus.js';
import { YouTubeChatAutoConnect } from './live/YouTubeChatAutoConnect.js';
import { PlatformAvailability } from './platforms/PlatformAvailability.js';
import { PlatformRegistry } from './platforms/PlatformRegistry.js';
import { TwitchPlatform } from './platforms/TwitchPlatform.js';
import { YouTubePlatform } from './platforms/YouTubePlatform.js';
import { RaidShoutout } from './raids/RaidShoutout.js';
import { loadRewardHandlers } from './rewards/loadRewardHandlers.js';
import { RewardRegistry } from './rewards/RewardRegistry.js';
import { RewardRouter } from './rewards/RewardRouter.js';
import { RewardSync } from './rewards/RewardSync.js';
import { HttpServer } from './server/HttpServer.js';
import { ActivityHandler } from './server/handlers/ActivityHandler.js';
import { CommandHandler } from './server/handlers/CommandHandler.js';
import { DataHandler } from './server/handlers/DataHandler.js';
import { OAuthHandler } from './server/handlers/OAuthHandler.js';
import { MessageRouter } from './server/MessageRouter.js';
import { createAppRouter } from './server/trpc/appRouter.js';
import { TrpcServer } from './server/trpc/TrpcServer.js';
import { WebSocketServer } from './server/WebSocketServer.js';
import { SOUND_SETTINGS } from './sounds/soundSettings.js';
import { TuringModConfig } from './utils/Config.js';
import { Encryption } from './utils/Encryption.js';
import { Logger } from './utils/Logger.js';

/**
 * Register the handful of classes tsyringe can't auto-construct from decorated constructor
 * parameters alone, because their constructors take primitives/derived values (a log level, a
 * db path, a master password + salt, an allowed-origins list) rather than other injectable
 * classes. Everything else is wired implicitly via @singleton() (or @injectable()) on the class
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
        config.serverPort,
        config.host,
        config.frontendDistPath,
        c.resolve(OAuthFlowService),
        c.resolve(Logger)
      );
    }),
  });

  container.register(WebSocketServer, {
    useFactory: instanceCachingFactory(
      (c) =>
        new WebSocketServer(
          c.resolve(MessageRouter),
          consoleOrigins(c.resolve(TuringModConfig)),
          c.resolve(Logger)
        )
    ),
  });

  container.register(TrpcServer, {
    useFactory: instanceCachingFactory(
      (c) =>
        new TrpcServer(
          createAppRouter(c),
          consoleOrigins(c.resolve(TuringModConfig)),
          c.resolve(Logger)
        )
    ),
  });
}

/**
 * The console served by the backend itself, or by the Vite dev server in development: the only
 * pages ever allowed to open a WebSocket connection to us. Either may be opened as localhost or
 * 127.0.0.1 (both reach the same loopback server, whatever HOST is), and the browser sends
 * whichever was typed as the origin.
 */
function consoleOrigins(config: TuringModConfig): string[] {
  return ['127.0.0.1', 'localhost'].flatMap((host) =>
    [config.serverPort, DEFAULT_FRONTEND_DEV_PORT].map((port) => `http://${host}:${port}`)
  );
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
  const { ALL_MIGRATIONS } = await import('./database/migrations/index.js');
  container.resolve(MigrationRunner).runMigrations([...ALL_MIGRATIONS]);

  // Read every settings group once, so stored settings that don't fit their schema stop startup
  // with the bad fields named, instead of failing the first time a feature reads them.
  const settings = container.resolve(SettingsRepository);
  for (const definition of ALL_SETTINGS) {
    settings.get(definition);
  }
}

/** Every settings group TuringMod reads. */
const ALL_SETTINGS: readonly SettingsDefinition<unknown>[] = [
  BREAK_SETTINGS,
  SOUND_SETTINGS,
  EFFECT_SETTINGS,
];

/**
 * Initialize application components
 * Registers commands, integrations, and message handlers
 */
export async function initializeComponents(): Promise<void> {
  const logger = container.resolve(Logger);
  logger.info('Initializing components');

  // Auto-discover and register commands
  await loadCommands(container.resolve(CommandRegistry), logger);

  // Auto-discover and register channel point reward handlers
  await loadRewardHandlers(container.resolve(RewardRegistry), logger);

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

  // Feature services, started by Application before integrations (so they see the availability
  // changes connecting causes) and stopped in reverse before integrations (so they can still reach
  // OBS and Twitch to undo what they did). Whatever triggers actions comes last, so it stops first.
  const services = container.resolve(ServiceLifecycle);
  // Publishes platform.availability; snapshots each façade before integrations connect.
  services.add(container.resolve(PlatformAvailability));
  // EventBus activity to the live tail (broadcast) and activity_log (persist).
  services.add(container.resolve(ActivityForwarder));
  // Keeps each reward handler's reward on Twitch matching its definition. Before BreakService:
  // ending a break on shutdown unpauses rewards, so this must still be listening.
  services.add(container.resolve(RewardSync));
  // Stream breaks: Twitch ad breaks (and !break) take the streamer off camera and mic; stopping
  // restores OBS. AdWarningScheduler reads its poll interval from the break settings.
  services.add(container.resolve(BreakService));
  services.add(container.resolve(AdWarningScheduler));
  // Stopping cuts a running effect short and restores the facecam.
  services.add(container.resolve(FacecamEffectRunner));
  // Chat services: the interval-message rotation, clip collection (only collects while switched
  // on; stopping writes out a collection in progress), and the lurk list.
  services.add(container.resolve(IntervalAnnouncer));
  services.add(container.resolve(ClipCollector));
  services.add(container.resolve(LurkTracker));
  // Go-live: whether OBS is streaming, and connecting YouTube chat (which exists per broadcast)
  // while it is.
  services.add(container.resolve(ObsStreamState));
  services.add(container.resolve(YouTubeChatAutoConnect));
  // Whether each platform is live, for the console's header.
  services.add(container.resolve(PlatformLiveStatus));
  // The Discord go-live post, driven by PlatformLiveStatus.
  services.add(container.resolve(GoLiveAnnouncer));
  // The Data page's read-only connection, which stopping closes before the database is.
  services.add(container.resolve(DataInspector));
  // Triggers: raids, channel point redemptions, and chat (gated to drop TuringMod's own messages,
  // then moderated, parsed and executed).
  services.add(container.resolve(RaidShoutout));
  services.add(container.resolve(RewardRouter));
  services.add(container.resolve(OwnChatMessages));
  services.add(container.resolve(ChatRouter));

  // Register message handlers
  const messageRouter = container.resolve(MessageRouter);
  const commandHandler = container.resolve(CommandHandler);
  const oauthHandler = container.resolve(OAuthHandler);
  const webSocketServer = container.resolve(WebSocketServer);
  const activityHandler = container.resolve(ActivityHandler);
  const dataHandler = container.resolve(DataHandler);

  messageRouter.registerHandler(MessageType.COMMAND_SIMULATE, (msg) =>
    commandHandler.handleSimulate(msg)
  );

  messageRouter.registerHandler(MessageType.COMMAND_LIST, (msg) => commandHandler.handleList(msg));

  // The console's origin is where the callback page sends the streamer back to.
  messageRouter.registerHandler(MessageType.OAUTH_GET_AUTH_URL, (msg, clientId) =>
    oauthHandler.handleGetAuthUrl(msg, webSocketServer.originOf(clientId))
  );

  messageRouter.registerHandler(MessageType.ACTIVITY_QUERY, (msg) =>
    activityHandler.handleQuery(msg)
  );

  messageRouter.registerHandler(MessageType.DATA_LIST_TABLES, (msg) =>
    dataHandler.handleListTables(msg)
  );

  messageRouter.registerHandler(MessageType.DATA_QUERY_ROWS, (msg) =>
    dataHandler.handleQueryRows(msg)
  );

  logger.info('Components initialized');
}
