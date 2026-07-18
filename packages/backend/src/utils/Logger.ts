import type { Logger as PinoLogger } from 'pino';
import pino from 'pino';
import pinoPretty from 'pino-pretty';

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
 * Rejects plain-object-shaped values (e.g. `{ error }`) while still allowing
 * `Error`, `string`, and the opaque `unknown` a `catch` clause hands you.
 * `unknown` doesn't structurally match `Record<string, unknown>`, so it
 * passes through untouched; a literal like `{ error }` does match and
 * collapses to `never`, turning it into a compile error at the call site.
 */
type NotPlainObject<T> = T extends Record<string, unknown> ? never : T;

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

    // Built in-process (rather than via `transport`, which runs pino-pretty in a worker
    // thread and can only accept JSON-serializable options) so `messageFormat` can be a
    // function that folds `component` into the message line.
    const prettyStream = pretty
      ? pinoPretty({
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,component',
          messageFormat: (log, messageKey) =>
            log.component ? `[${log.component}] ${log[messageKey]}` : String(log[messageKey]),
        })
      : undefined;

    this.logger = prettyStream ? pino(config, prettyStream) : pino(config);
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
   * Log error message. `error` should be the caught Error (or unknown catch
   * value) itself; use `meta` for any additional structured context.
   * `NotPlainObject<E>` blocks passing an object literal like `{ error }`
   * here as a compile error, while still allowing a bare `unknown` through.
   */
  error<E>(message: string, error?: NotPlainObject<E>, meta?: Record<string, unknown>): void {
    if (error instanceof Error) {
      this.logger.error({ err: error, ...meta }, message);
    } else if (error === undefined) {
      this.logger.error(meta ?? {}, message);
    } else {
      this.logger.error({ error, ...meta }, message);
    }
  }

  /**
   * Log fatal message. `error` should be the caught Error (or unknown catch
   * value) itself; use `meta` for any additional structured context.
   * `NotPlainObject<E>` blocks passing an object literal like `{ error }`
   * here as a compile error, while still allowing a bare `unknown` through.
   */
  fatal<E>(message: string, error?: NotPlainObject<E>, meta?: Record<string, unknown>): void {
    if (error instanceof Error) {
      this.logger.fatal({ err: error, ...meta }, message);
    } else if (error === undefined) {
      this.logger.fatal(meta ?? {}, message);
    } else {
      this.logger.fatal({ error, ...meta }, message);
    }
  }
}
