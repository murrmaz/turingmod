import type { Logger as PinoLogger } from 'pino';
import pino from 'pino';
import pinoPretty from 'pino-pretty';

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Log level */
  level?: pino.LevelWithSilentOrString;

  /** Whether to format logs for reading in a terminal rather than as JSON lines */
  pretty?: boolean;

  /** Where JSON lines go instead of stdout, for tests that read them back. Ignored with `pretty`. */
  destination?: pino.DestinationStream;
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
 * The fields a log line gets from what was passed beside its message: a plain object's own fields,
 * an Error under `err` (serialized with its message and stack), or anything else under `detail`.
 */
function toFields(detail: unknown): Record<string, unknown> {
  if (detail === undefined) {
    return {};
  }
  if (detail instanceof Error) {
    return { err: detail };
  }
  if (isPlainObject(detail)) {
    return detail;
  }
  return { detail };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The fields for a caught value: an Error under `err`, anything else under `error`. */
function caughtFields(error: unknown): Record<string, unknown> {
  if (error === undefined) {
    return {};
  }
  return error instanceof Error ? { err: error } : { error };
}

/**
 * Application logger wrapper around Pino
 * Provides consistent logging across the application
 */
export class Logger {
  private logger: PinoLogger;

  constructor(options: LoggerOptions = {}) {
    const { level = 'info', pretty = false, destination } = options;

    const config: pino.LoggerOptions = {
      level,
      // Pino serializes only `err` as an Error by default; an Error under `error` (as in
      // `{ error }` fields) would otherwise be written as `{}`, its message and stack lost.
      serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
    };

    // Built in-process (rather than via `transport`, which runs pino-pretty in a worker
    // thread and can only accept JSON-serializable options) so `messageFormat` can be a
    // function that folds `component` into the message line.
    const stream = pretty
      ? pinoPretty({
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,component',
          messageFormat: (log, messageKey) =>
            log.component ? `[${log.component}] ${log[messageKey]}` : String(log[messageKey]),
        })
      : destination;

    this.logger = stream ? pino(config, stream) : pino(config);
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
   * Log trace message. `detail` is structured fields (a plain object), or a caught value.
   */
  trace(message: string, detail?: unknown): void {
    this.logger.trace(toFields(detail), message);
  }

  /**
   * Log debug message. `detail` is structured fields (a plain object), or a caught value.
   */
  debug(message: string, detail?: unknown): void {
    this.logger.debug(toFields(detail), message);
  }

  /**
   * Log info message. `detail` is structured fields (a plain object), or a caught value.
   */
  info(message: string, detail?: unknown): void {
    this.logger.info(toFields(detail), message);
  }

  /**
   * Log warning message. `detail` is structured fields (a plain object), or a caught value: an
   * Error is logged with its message and stack.
   */
  warn(message: string, detail?: unknown): void {
    this.logger.warn(toFields(detail), message);
  }

  /**
   * Log error message. `error` should be the caught Error (or unknown catch
   * value) itself; use `meta` for any additional structured context.
   * `NotPlainObject<E>` blocks passing an object literal like `{ error }`
   * here as a compile error, while still allowing a bare `unknown` through.
   */
  error<E>(message: string, error?: NotPlainObject<E>, meta?: Record<string, unknown>): void {
    this.logger.error({ ...meta, ...caughtFields(error) }, message);
  }

  /**
   * Log fatal message. `error` should be the caught Error (or unknown catch
   * value) itself; use `meta` for any additional structured context.
   * `NotPlainObject<E>` blocks passing an object literal like `{ error }`
   * here as a compile error, while still allowing a bare `unknown` through.
   */
  fatal<E>(message: string, error?: NotPlainObject<E>, meta?: Record<string, unknown>): void {
    this.logger.fatal({ ...meta, ...caughtFields(error) }, message);
  }
}
