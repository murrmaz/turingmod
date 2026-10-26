// First, so .env is loaded before any module reads configuration.
import './utils/loadEnv.js';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Application } from './core/Application.js';
import { initializeComponents, initializeDatabase, registerRootFactories } from './setup.js';
import { ConfigurationError } from './utils/Config.js';
import { Logger } from './utils/Logger.js';

/**
 * Main entry point for TuringMod backend
 */
async function main(): Promise<void> {
  // Register the handful of classes tsyringe can't auto-construct (see setup.ts for why).
  // Everything else wires itself up via @singleton() (or @injectable()) on the class definitions.
  registerRootFactories();

  // Get logger
  const logger = container.resolve(Logger);
  handleProcessEvents(logger);

  logger.info('========================================');
  logger.info('               TuringMod                ');
  logger.info('========================================');

  // Open the database and run migrations first — the Encryption singleton reads its salt from
  // the settings table, and it gets resolved transitively as soon as components are registered.
  await initializeDatabase();

  // Initialize components (register commands, integrations, handlers)
  await initializeComponents();

  // Get application instance
  const application = container.resolve(Application);
  app = application;

  // Initialize application (load integrations from database), then start it (servers,
  // integrations)
  startup = application.initialize().then(() => application.start());
  await startup;
}

/** The application, once resolved, and its startup, so a signal can wait for what's starting. */
let app: Application | null = null;
let startup: Promise<void> = Promise.resolve();
let shuttingDown = false;

/**
 * Shut down gracefully on SIGINT/SIGTERM, and exit on a crash. Installed before anything starts,
 * so a signal during startup still stops what has started (once it has), rather than killing the
 * process with a break or effect half applied. Stops once: a second signal while stopping exits
 * at once, for a shutdown that hangs.
 */
function handleProcessEvents(logger: Logger): void {
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`Received ${signal} again, exiting without finishing shutdown`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await startup.catch(() => undefined);
      await app?.stop();
      process.exit(0);
    } catch (error) {
      logger.fatal('Shutdown failed', error);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (error: Error) => {
    logger.fatal('Uncaught exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal('Unhandled rejection', reason);
    process.exit(1);
  });
}

// Start the application
main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    // A setup problem with its own explanation; a stack trace would only bury it.
    console.error(`TuringMod can't start.\n\n${error.message}`);
  } else {
    console.error('Failed to start TuringMod:', error);
  }
  process.exit(1);
});
