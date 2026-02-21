import {
  type CommandExecutePayload,
  type CommandSimulatePayload,
  type IWebSocketMessage,
  type IntegrationConfigurePayload,
  type IntegrationStartPayload,
  type IntegrationStopPayload,
  MessageType,
  type OAuthExchangeCodePayload,
  type OAuthGetAuthUrlPayload,
} from '@turingmod/shared';
import { CommandExecutor } from './commands/CommandExecutor.js';
import { CommandRegistry } from './commands/CommandRegistry.js';
import { loadCommands } from './commands/loadCommands.js';
import { Application } from './core/Application.js';
import type { Container } from './core/Container.js';
import { EventBus } from './core/EventBus.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { MigrationRunner } from './database/migrations/MigrationRunner.js';
import { CommandHistoryRepository } from './database/repositories/CommandHistoryRepository.js';
import { IntegrationStateRepository } from './database/repositories/IntegrationStateRepository.js';
import { UserRepository } from './database/repositories/UserRepository.js';
import { IntegrationManager } from './integrations/IntegrationManager.js';
import { ArduinoIntegration } from './integrations/implementations/ArduinoIntegration.js';
import { DiscordIntegration } from './integrations/implementations/DiscordIntegration.js';
import { ObsIntegration } from './integrations/implementations/ObsIntegration.js';
import { SoundIntegration } from './integrations/implementations/SoundIntegration.js';
import { SpotifyApiIntegration } from './integrations/implementations/SpotifyApiIntegration.js';
import { SpotifyAuthIntegration } from './integrations/implementations/SpotifyAuthIntegration.js';
import { TwitchApiIntegration } from './integrations/implementations/TwitchApiIntegration.js';
import { TwitchAuthIntegration } from './integrations/implementations/TwitchAuthIntegration.js';
import { TwitchEventSubIntegration } from './integrations/implementations/TwitchEventSubIntegration.js';
import { HttpServer } from './server/HttpServer.js';
import { MessageRouter } from './server/MessageRouter.js';
import { WebSocketServer } from './server/WebSocketServer.js';
import { CommandHandler } from './server/handlers/CommandHandler.js';
import { IntegrationHandler } from './server/handlers/IntegrationHandler.js';
import { OAuthHandler } from './server/handlers/OAuthHandler.js';
import { TuringModConfig } from './utils/Config.js';
import { Encryption } from './utils/Encryption.js';
import { Logger } from './utils/Logger.js';

/**
 * Set up dependency injection container
 * Registers all services and their dependencies
 */
export function setupDependencies(container: Container): void {
  // Core utilities (singletons)
  container.registerSingleton('Config', () => new TuringModConfig());

  container.registerSingleton(
    'Logger',
    () =>
      new Logger({
        level: container.resolve<TuringModConfig>('Config').logLevel,
        pretty: true,
      })
  );

  container.registerSingleton('EventBus', () => new EventBus());

  container.registerSingleton(
    'Encryption',
    () => new Encryption(container.resolve<TuringModConfig>('Config').masterPassword)
  );

  // Database (singletons)
  container.registerSingleton(
    'DatabaseManager',
    () =>
      new DatabaseManager(
        container.resolve<TuringModConfig>('Config').dbPath,
        container.resolve<Logger>('Logger')
      )
  );

  container.registerSingleton(
    'MigrationRunner',
    () =>
      new MigrationRunner(
        container.resolve<DatabaseManager>('DatabaseManager'),
        container.resolve<Logger>('Logger')
      )
  );

  // Repositories (singletons)
  container.registerSingleton(
    'UserRepository',
    () => new UserRepository(container.resolve<DatabaseManager>('DatabaseManager'))
  );

  container.registerSingleton(
    'CommandHistoryRepository',
    () => new CommandHistoryRepository(container.resolve<DatabaseManager>('DatabaseManager'))
  );

  container.registerSingleton(
    'IntegrationStateRepository',
    () =>
      new IntegrationStateRepository(
        container.resolve<DatabaseManager>('DatabaseManager'),
        container.resolve<Encryption>('Encryption')
      )
  );

  // Command system (singletons)
  container.registerSingleton(
    'CommandRegistry',
    () => new CommandRegistry(container.resolve<Logger>('Logger'))
  );

  container.registerSingleton(
    'CommandExecutor',
    () =>
      new CommandExecutor(
        container.resolve<CommandRegistry>('CommandRegistry'),
        container.resolve<CommandHistoryRepository>('CommandHistoryRepository'),
        container.resolve<Logger>('Logger')
      )
  );

  // Integration system (singletons)
  container.registerSingleton(
    'IntegrationManager',
    () =>
      new IntegrationManager(
        container.resolve<IntegrationStateRepository>('IntegrationStateRepository'),
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger')
      )
  );

  // Register Twitch integrations (with dependency chain)
  container.registerSingleton(
    'TwitchAuthIntegration',
    () =>
      new TwitchAuthIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger'),
        container.resolve<IntegrationStateRepository>('IntegrationStateRepository')
      )
  );

  container.registerSingleton(
    'TwitchApiIntegration',
    () =>
      new TwitchApiIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger'),
        container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration')
      )
  );

  container.registerSingleton(
    'TwitchEventSubIntegration',
    () =>
      new TwitchEventSubIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger'),
        container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration'),
        container.resolve<TwitchApiIntegration>('TwitchApiIntegration')
      )
  );

  // Register Spotify integrations (with dependency chain: Auth → API)
  container.registerSingleton(
    'SpotifyAuthIntegration',
    () =>
      new SpotifyAuthIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger'),
        container.resolve<IntegrationStateRepository>('IntegrationStateRepository')
      )
  );

  container.registerSingleton(
    'SpotifyApiIntegration',
    () =>
      new SpotifyApiIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger'),
        container.resolve<SpotifyAuthIntegration>('SpotifyAuthIntegration')
      )
  );

  // Register other integrations
  container.registerSingleton(
    'DiscordIntegration',
    () =>
      new DiscordIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger')
      )
  );

  container.registerSingleton(
    'ArduinoIntegration',
    () =>
      new ArduinoIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger')
      )
  );

  container.registerSingleton(
    'ObsIntegration',
    () =>
      new ObsIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger')
      )
  );

  container.registerSingleton(
    'SoundIntegration',
    () =>
      new SoundIntegration(
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger')
      )
  );

  // Servers (singletons)
  container.registerSingleton('HttpServer', () => {
    const config = container.resolve<TuringModConfig>('Config');
    return new HttpServer(
      config.wsPort,
      config.host,
      config.frontendDistPath,
      container.resolve<EventBus>('EventBus'),
      container.resolve<Logger>('Logger')
    );
  });

  container.registerSingleton(
    'MessageRouter',
    () => new MessageRouter(container.resolve<Logger>('Logger'))
  );

  container.registerSingleton(
    'WebSocketServer',
    () =>
      new WebSocketServer(
        container.resolve<MessageRouter>('MessageRouter'),
        container.resolve<Logger>('Logger')
      )
  );

  // Message handlers (singletons)
  container.registerSingleton(
    'CommandHandler',
    () =>
      new CommandHandler(
        container.resolve<CommandExecutor>('CommandExecutor'),
        container.resolve<CommandRegistry>('CommandRegistry'),
        container.resolve<Logger>('Logger')
      )
  );

  container.registerSingleton(
    'IntegrationHandler',
    () =>
      new IntegrationHandler(
        container.resolve<IntegrationManager>('IntegrationManager'),
        container.resolve<Logger>('Logger')
      )
  );

  container.registerSingleton(
    'OAuthHandler',
    () =>
      new OAuthHandler(
        container.resolve<IntegrationManager>('IntegrationManager'),
        container.resolve<IntegrationStateRepository>('IntegrationStateRepository'),
        container.resolve<Logger>('Logger')
      )
  );

  // Application (singleton)
  container.registerSingleton(
    'Application',
    () =>
      new Application(
        container.resolve<DatabaseManager>('DatabaseManager'),
        container.resolve<MigrationRunner>('MigrationRunner'),
        container.resolve<HttpServer>('HttpServer'),
        container.resolve<WebSocketServer>('WebSocketServer'),
        container.resolve<IntegrationManager>('IntegrationManager'),
        container.resolve<EventBus>('EventBus'),
        container.resolve<Logger>('Logger')
      )
  );
}

/**
 * Initialize application components
 * Registers commands, integrations, and message handlers
 */
export async function initializeComponents(container: Container): Promise<void> {
  const logger = container.resolve<Logger>('Logger');
  logger.info('Initializing components');

  // Auto-discover and register commands
  const commandRegistry = container.resolve<CommandRegistry>('CommandRegistry');
  await loadCommands(container, commandRegistry, logger);

  // Register integrations
  const integrationManager = container.resolve<IntegrationManager>('IntegrationManager');

  // Register Twitch integrations (order matters: Auth → API → EventSub)
  integrationManager.register(container.resolve<TwitchAuthIntegration>('TwitchAuthIntegration'));
  integrationManager.register(container.resolve<TwitchApiIntegration>('TwitchApiIntegration'));
  integrationManager.register(
    container.resolve<TwitchEventSubIntegration>('TwitchEventSubIntegration')
  );

  // Register Spotify integrations (order matters: Auth → API)
  integrationManager.register(container.resolve<SpotifyAuthIntegration>('SpotifyAuthIntegration'));
  integrationManager.register(container.resolve<SpotifyApiIntegration>('SpotifyApiIntegration'));

  // Register other integrations
  integrationManager.register(container.resolve<DiscordIntegration>('DiscordIntegration'));
  integrationManager.register(container.resolve<ArduinoIntegration>('ArduinoIntegration'));
  integrationManager.register(container.resolve<ObsIntegration>('ObsIntegration'));
  integrationManager.register(container.resolve<SoundIntegration>('SoundIntegration'));

  // Register message handlers
  const messageRouter = container.resolve<MessageRouter>('MessageRouter');
  const commandHandler = container.resolve<CommandHandler>('CommandHandler');
  const integrationHandler = container.resolve<IntegrationHandler>('IntegrationHandler');
  const oauthHandler = container.resolve<OAuthHandler>('OAuthHandler');

  messageRouter.registerHandler(MessageType.COMMAND_EXECUTE, (msg) =>
    commandHandler.handleExecute(msg as IWebSocketMessage<CommandExecutePayload>)
  );

  messageRouter.registerHandler(MessageType.COMMAND_SIMULATE, (msg) =>
    commandHandler.handleSimulate(msg as IWebSocketMessage<CommandSimulatePayload>)
  );

  messageRouter.registerHandler(MessageType.COMMAND_LIST, (msg) => commandHandler.handleList(msg));

  messageRouter.registerHandler(MessageType.INTEGRATION_START, (msg) =>
    integrationHandler.handleStart(msg as IWebSocketMessage<IntegrationStartPayload>)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_STOP, (msg) =>
    integrationHandler.handleStop(msg as IWebSocketMessage<IntegrationStopPayload>)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_STATUS_REQUEST, (msg) =>
    integrationHandler.handleList(msg)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_LIST, (msg) =>
    integrationHandler.handleList(msg)
  );

  messageRouter.registerHandler(MessageType.INTEGRATION_CONFIGURE, (msg) =>
    integrationHandler.handleConfigure(msg as IWebSocketMessage<IntegrationConfigurePayload>)
  );

  messageRouter.registerHandler(MessageType.OAUTH_GET_AUTH_URL, (msg) =>
    oauthHandler.handleGetAuthUrl(msg as IWebSocketMessage<OAuthGetAuthUrlPayload>)
  );

  messageRouter.registerHandler(MessageType.OAUTH_EXCHANGE_CODE, (msg) =>
    oauthHandler.handleExchangeCode(msg as IWebSocketMessage<OAuthExchangeCodePayload>)
  );

  logger.info('Components initialized');
}
