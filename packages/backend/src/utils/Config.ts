import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_SERVER_PORT } from '@turingmod/shared';
import type { LevelWithSilentOrString } from 'pino';
import { singleton } from 'tsyringe';
import { ENV_FILE } from './paths.js';

/**
 * A configuration problem the streamer has to fix before TuringMod can start. Its message is the
 * whole explanation, so the entry point prints it without a stack trace.
 */
export class ConfigurationError extends Error {}

/**
 * The master password, which the stored integration credentials are encrypted with. Required, with
 * no default: a default password is in the source for anyone to read, so credentials encrypted with
 * it are as good as plain text to whoever gets a copy of the database.
 *
 * @param envFile Where `.env` is expected, and whether it exists, for the message when it's missing.
 */
export function requireMasterPassword(
  value: string | undefined,
  envFile: { path: string; exists: boolean }
): string {
  if (value !== undefined && value.trim() !== '') {
    return value;
  }

  const why =
    'MASTER_PASSWORD encrypts the credentials TuringMod stores for its integrations. Choose it ' +
    'before connecting any of them: changing it later makes the stored credentials unreadable, ' +
    'and each integration then has to be set up again.';

  if (!envFile.exists) {
    throw new ConfigurationError(
      [
        `TuringMod needs a .env file, and there is none at ${envFile.path}.`,
        '',
        'Create it from the template in the repository root, then set MASTER_PASSWORD in it:',
        '',
        '  cp .env.example .env',
        '',
        why,
      ].join('\n')
    );
  }
  throw new ConfigurationError(
    [
      `MASTER_PASSWORD is ${value === undefined ? 'not set' : 'empty'}. Set it in ${envFile.path}`,
      '(see .env.example for every setting).',
      '',
      why,
    ].join('\n')
  );
}

/**
 * Where the database lives: DB_PATH, or `turingmod.db` in the working directory. Standalone so
 * tools can find the app's database without the rest of the configuration.
 */
export function resolveDbPath(): string {
  return process.env.DB_PATH ?? join(process.cwd(), 'turingmod.db');
}

@singleton()
export class TuringModConfig {
  /**
   * The port the backend listens on: the HTTP server, the WebSocket endpoint it hosts, and the
   * OAuth redirect URIs, which providers send the browser back to.
   */
  readonly serverPort: number;

  /** Server host (should always be localhost) */
  readonly host: string;

  /** Database file path */
  readonly dbPath: string;

  /** Log level */
  readonly logLevel: LevelWithSilentOrString;

  /** Master password the stored integration credentials are encrypted with (required) */
  readonly masterPassword: string;

  /** Frontend static files directory (for production) */
  readonly frontendDistPath: string;

  constructor() {
    if (process.env.WS_PORT !== undefined && process.env.SERVER_PORT === undefined) {
      // Renamed because it was never only the WebSocket's port. Refuse rather than ignore it, so
      // a customized port can't silently fall back to the default.
      throw new Error('WS_PORT has been renamed to SERVER_PORT; set SERVER_PORT instead.');
    }
    this.serverPort = this.parseNumber(process.env.SERVER_PORT, DEFAULT_SERVER_PORT);
    this.host = process.env.HOST ?? DEFAULT_HOST;
    this.dbPath = resolveDbPath();
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL);
    this.masterPassword = requireMasterPassword(process.env.MASTER_PASSWORD, {
      path: ENV_FILE,
      exists: existsSync(ENV_FILE),
    });
    const dirname = fileURLToPath(new URL('.', import.meta.url));
    this.frontendDistPath =
      process.env.FRONTEND_DIST_PATH ?? join(dirname, '..', '..', '..', 'frontend', 'dist');

    // Validate configuration
    this.validate();
  }

  /**
   * Parse number from environment variable
   */
  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Parse log level from environment variable
   */
  private parseLogLevel(value?: string): LevelWithSilentOrString {
    if (value === undefined) {
      return 'info';
    }
    return value as LevelWithSilentOrString;
  }

  /**
   * Validate configuration
   */
  private validate(): void {
    if (this.host !== '127.0.0.1' && this.host !== 'localhost') {
      throw new Error(
        `Invalid host: ${this.host}. For security, only localhost (127.0.0.1) is allowed.`
      );
    }

    if (this.serverPort < 1 || this.serverPort > 65535) {
      throw new Error(`Invalid port: ${this.serverPort}. Must be between 1 and 65535.`);
    }
  }

  /**
   * Get configuration as plain object
   */
  toObject(): Record<string, unknown> {
    return {
      serverPort: this.serverPort,
      host: this.host,
      dbPath: this.dbPath,
      logLevel: this.logLevel,
      frontendDistPath: this.frontendDistPath,
      // Exclude masterPassword from logging
    };
  }
}
