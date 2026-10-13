import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_SERVER_PORT } from '@turingmod/shared';
import type { LevelWithSilentOrString } from 'pino';
import { injectable, singleton } from 'tsyringe';

/**
 * Application configuration
 * Loads from environment variables with sensible defaults
 */
/**
 * Where the database lives: DB_PATH, or `turingmod.db` in the working directory. Standalone so
 * tools can find the app's database without the rest of the configuration.
 */
export function resolveDbPath(): string {
  return process.env.DB_PATH ?? join(process.cwd(), 'turingmod.db');
}

@injectable()
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

  /** Master password for encryption (should be set in production) */
  readonly masterPassword: string;

  /** Node environment */
  readonly nodeEnv: string;

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
    this.masterPassword = process.env.MASTER_PASSWORD ?? this.generateDefaultPassword();
    this.nodeEnv = process.env.NODE_ENV ?? 'development';
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
   * Generate a default password (should be replaced in production)
   */
  private generateDefaultPassword(): string {
    console.warn(
      'WARNING: Using default master password. Set MASTER_PASSWORD environment variable in production!'
    );
    return 'default-insecure-password-change-me';
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

    if (
      this.nodeEnv === 'production' &&
      this.masterPassword === 'default-insecure-password-change-me'
    ) {
      throw new Error('MASTER_PASSWORD must be set in production environment for security!');
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
      nodeEnv: this.nodeEnv,
      frontendDistPath: this.frontendDistPath,
      // Exclude masterPassword from logging
    };
  }
}
