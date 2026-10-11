import 'reflect-metadata';
import { container } from 'tsyringe';
import { Application } from './core/Application.js';
import { initializeComponents, initializeDatabase, registerRootFactories } from './setup.js';
import { Logger } from './utils/Logger.js';

/**
 * Main entry point for TuringMod backend
 */
async function main(): Promise<void> {
  // Register the handful of classes tsyringe can't auto-construct (see setup.ts for why).
  // Everything else wires itself up via @injectable()/@singleton() on the class definitions.
  registerRootFactories();

  // Get logger
  const logger = container.resolve(Logger);

  logger.info('========================================');
  logger.info('  TuringMod - Twitch Streamer Tool  ');
  logger.info('========================================');

  // Open the database and run migrations first — the Encryption singleton reads its salt from
  // the settings table, and it gets resolved transitively as soon as components are registered.
  await initializeDatabase();

  // Initialize components (register commands, integrations, handlers)
  await initializeComponents();

  // Get application instance
  const app = container.resolve(Application);

  // Initialize application (load integrations from database)
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
