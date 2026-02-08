import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Log level */
  level?: pino.LevelWithSilentOrString;

  /** Whether to enable pretty printing (for development) */
  pretty?: boolean;

  /** Optional log file path */
  logFile?: string;
}

/**
 * Application logger wrapper around Pino
 * Provides consistent logging across the application
 */
export class Logger {
  private logger: PinoLogger;

  constructor(options: LoggerOptions = {}) {
    const { level = 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

    const config: pino.LoggerOptions = {
      level,
    };

    if (pretty) {
      config.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      };
    }

    this.logger = pino(config);
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, unknown>): Logger {
    const childLogger = new Logger({ level: this.logger.level });
    childLogger.logger = this.logger.child(bindings);
    return childLogger;
  }

  /**
   * Log trace message
   */
  trace(message: string, ...args: unknown[]): void {
    this.logger.trace(args.length > 0 ? { ...args } : {}, message);
  }

  /**
   * Log debug message
   */
  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(args.length > 0 ? { ...args } : {}, message);
  }

  /**
   * Log info message
   */
  info(message: string, ...args: unknown[]): void {
    this.logger.info(args.length > 0 ? { ...args } : {}, message);
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(args.length > 0 ? { ...args } : {}, message);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, ...args: unknown[]): void {
    if (error instanceof Error) {
      this.logger.error({ err: error, ...(args.length > 0 ? { ...args } : {}) }, message);
    } else if (error !== undefined) {
      this.logger.error({ error, ...(args.length > 0 ? { ...args } : {}) }, message);
    } else {
      this.logger.error(args.length > 0 ? { ...args } : {}, message);
    }
  }

  /**
   * Log fatal message
   */
  fatal(message: string, error?: Error | unknown, ...args: unknown[]): void {
    if (error instanceof Error) {
      this.logger.fatal({ err: error, ...(args.length > 0 ? { ...args } : {}) }, message);
    } else if (error !== undefined) {
      this.logger.fatal({ error, ...(args.length > 0 ? { ...args } : {}) }, message);
    } else {
      this.logger.fatal(args.length > 0 ? { ...args } : {}, message);
    }
  }
}
