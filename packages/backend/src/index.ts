// First, so .env is loaded before any module reads configuration.
import './utils/loadEnv.js';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Application } from './Application.js';
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

  const rootLogger = container.resolve(Logger);
  const logger = rootLogger.child({ component: 'Process' });

  let app: Application | null = null;
  handleProcessEvents(logger, async () => {
    await app?.stop();
  });

  rootLogger.info('========================================');
  rootLogger.info('               TuringMod                ');
  rootLogger.info('========================================');

  try {
    // Open the database and run migrations first: the Encryption singleton reads its salt from
    // the settings table, and it gets resolved transitively as soon as components are registered.
    await initializeDatabase();

    // Initialize components (register commands, integrations, handlers)
    await initializeComponents();

    app = container.resolve(Application);
    await app.start();
  } catch (error) {
    logger.fatal('Failed to start TuringMod', error);
    process.exit(1);
  }
}

/**
 * Shut down gracefully on SIGINT/SIGTERM, and exit on a crash. Installed before anything starts,
 * so a signal during startup still stops what has started, rather than killing the process with a
 * break or effect half applied. Stops once: a second signal while stopping exits at once, for a
 * shutdown that hangs.
 */
function handleProcessEvents(logger: Logger, stop: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`Received ${signal} again, exiting without finishing shutdown`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await stop();
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

// Start the application. What reaches here failed before the logger existed.
main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    // A setup problem with its own explanation; a stack trace would only bury it.
    console.error(`TuringMod can't start.\n\n${error.message}`);
  } else {
    console.error('Failed to start TuringMod:', error);
  }
  process.exit(1);
});
