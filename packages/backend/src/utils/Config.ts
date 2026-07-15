import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_WS_PORT } from '@turingmod/shared';
import type { LevelWithSilentOrString } from 'pino';

/**
 * Application configuration
 * Loads from environment variables with sensible defaults
 */
export class TuringModConfig {
  /** WebSocket server port */
  readonly wsPort: number;

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
    this.wsPort = this.parseNumber(process.env.WS_PORT, DEFAULT_WS_PORT);
    this.host = process.env.HOST ?? DEFAULT_HOST;
    this.dbPath = process.env.DB_PATH ?? join(process.cwd(), 'turingmod.db');
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

    if (this.wsPort < 1 || this.wsPort > 65535) {
      throw new Error(`Invalid port: ${this.wsPort}. Must be between 1 and 65535.`);
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
      wsPort: this.wsPort,
      host: this.host,
      dbPath: this.dbPath,
      logLevel: this.logLevel,
      nodeEnv: this.nodeEnv,
      frontendDistPath: this.frontendDistPath,
      // Exclude masterPassword from logging
    };
  }
}
