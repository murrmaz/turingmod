import { DEFAULT_FRONTEND_DEV_PORT } from '@turingmod/shared';
import { container, instanceCachingFactory } from 'tsyringe';
import { ServiceLifecycle } from './core/ServiceLifecycle.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { DataInspector } from './database/DataInspector.js';
import { MigrationRunner } from './database/migrations/MigrationRunner.js';
import {
  type SettingsDefinition,
  SettingsRepository,
} from './database/repositories/SettingsRepository.js';
import { ActivityForwarder } from './features/activity/ActivityForwarder.js';
import { AdWarningScheduler } from './features/breaks/AdWarningScheduler.js';
import { BreakService } from './features/breaks/BreakService.js';
import { BREAK_SETTINGS } from './features/breaks/breakSettings.js';
import { IntervalAnnouncer } from './features/chat/announcements/IntervalAnnouncer.js';
import { ChatRouter } from './features/chat/ChatRouter.js';
import { ClipCollector } from './features/chat/clips/ClipCollector.js';
import { LurkTracker } from './features/chat/lurk/LurkTracker.js';
import { CommandRegistry } from './features/commands/CommandRegistry.js';
import { loadCommands } from './features/commands/loadCommands.js';
import { EFFECT_SETTINGS } from './features/effects/effectSettings.js';
import { FacecamEffectRunner } from './features/effects/FacecamEffectRunner.js';
import { GoLiveAnnouncer } from './features/live/GoLiveAnnouncer.js';
import { ObsStreamState } from './features/live/ObsStreamState.js';
import { PlatformLiveStatus } from './features/live/PlatformLiveStatus.js';
import { YouTubeChatAutoConnect } from './features/live/YouTubeChatAutoConnect.js';
import { RaidShoutout } from './features/raids/RaidShoutout.js';
import { loadRewardHandlers } from './features/rewards/loadRewardHandlers.js';
import { RewardRegistry } from './features/rewards/RewardRegistry.js';
import { RewardRouter } from './features/rewards/RewardRouter.js';
import { RewardSync } from './features/rewards/RewardSync.js';
import { SOUND_SETTINGS } from './features/sounds/soundSettings.js';
import { discoverIntegrations } from './integrations/discoverIntegrations.js';
import { IntegrationManager } from './integrations/IntegrationManager.js';
import { OAuthFlowService } from './integrations/OAuthFlowService.js';
import { OwnChatMessages } from './platforms/OwnChatMessages.js';
import { PlatformAvailability } from './platforms/PlatformAvailability.js';
import { PlatformRegistry } from './platforms/PlatformRegistry.js';
import { TwitchPlatform } from './platforms/TwitchPlatform.js';
import { YouTubePlatform } from './platforms/YouTubePlatform.js';
import { HttpServer } from './server/HttpServer.js';
import { createAppRouter } from './server/trpc/appRouter.js';
import { TrpcServer } from './server/trpc/TrpcServer.js';
import { TuringModConfig } from './utils/Config.js';
import { Encryption } from './utils/Encryption.js';
import { Logger } from './utils/Logger.js';

/**
 * Register the handful of classes tsyringe can't auto-construct from decorated constructor
 * parameters alone, because their constructors take primitives/derived values (a log level, a
 * db path, a master password + salt, an allowed-origins list) rather than other injectable
 * classes. Everything else is wired implicitly via @singleton() (or @injectable()) on the class
 * itself — this is deliberately the only "wiring" code.
 *
 * instanceCachingFactory makes each factory lazy and run-once, like a singleton — in particular,
 * Encryption's factory must not run until after the database has been initialized and migrated
 * (see initializeDatabase below), since it reads a DB-stored salt.
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

  // Auto-discover and register integrations. Their order doesn't matter: IntegrationManager
  // orders startup and shutdown from the dependency graph.
  const integrationManager = container.resolve(IntegrationManager);
  await discoverIntegrations(integrationManager, logger);

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

  logger.info('Components initialized');
}
