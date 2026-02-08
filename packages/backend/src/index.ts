import type { Application } from './core/Application.js';
import { Container } from './core/Container.js';
import { initializeComponents, setupDependencies } from './setup.js';
import type { Logger } from './utils/Logger.js';

/**
 * Main entry point for TuringMod backend
 */
async function main(): Promise<void> {
  // Create dependency injection container
  const container = new Container();

  // Set up all dependencies
  setupDependencies(container);

  // Get logger
  const logger = container.resolve<Logger>('Logger');

  logger.info('========================================');
  logger.info('  TuringMod - Twitch Streamer Tool  ');
  logger.info('========================================');

  // Initialize components (register commands, integrations, handlers)
  await initializeComponents(container);

  // Get application instance
  const app = container.resolve<Application>('Application');

  // Initialize application (database, migrations)
  await app.initialize();

  // Start application (servers, integrations)
  await app.start();

  // Graceful shutdown handlers
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await app.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await app.stop();
    process.exit(0);
  });

  // Uncaught exception handler
  process.on('uncaughtException', (error: Error) => {
    logger.fatal('Uncaught exception', error);
    process.exit(1);
  });

  // Unhandled rejection handler
  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal('Unhandled rejection', reason);
    process.exit(1);
  });
}

// Start the application
main().catch((error) => {
  console.error('Failed to start TuringMod:', error);
  process.exit(1);
});
