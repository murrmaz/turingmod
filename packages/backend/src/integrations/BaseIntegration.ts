import { EventEmitter } from 'node:events';
import { type IntegrationGroup, IntegrationStatus, toError } from '@turingmod/shared';
import { z } from 'zod';
import type { Logger } from '../utils/Logger.js';
import {
  DependencyFailurePolicy,
  type IIntegration,
  type IntegrationEvents,
} from './interfaces/IIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

/** The config of an integration that has none. */
const NO_CONFIG = z.strictObject({});

/**
 * Shared status/error/event-emitter plumbing for IIntegration implementations.
 * Concrete integrations implement initialize/start/stop and call setStatus()
 * to report lifecycle transitions.
 */
export abstract class BaseIntegration implements IIntegration {
  abstract readonly name: string;

  /** Statuses whose `errorMessage` carries an explanation worth keeping. */
  private static readonly STATUSES_WITH_MESSAGE: ReadonlySet<IntegrationStatus> = new Set([
    IntegrationStatus.ERROR,
    IntegrationStatus.NEEDS_REAUTH,
    IntegrationStatus.BLOCKED,
  ]);

  protected status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  protected errorMessage: string | undefined;
  private readonly events = new EventEmitter<IntegrationEvents>();
  protected readonly logger: Logger;

  protected constructor(logger: Logger, loggerContext: Record<string, string>) {
    this.logger = logger.child(loggerContext);
  }

  /**
   * Apply the stored config. This one is for an integration with no config, so anything stored
   * for it is a mistake; an integration that has one overrides it to parse against its schema
   * with parseConfig().
   */
  initialize(stored: unknown): Promise<void> {
    this.parseConfig(NO_CONFIG, stored);
    return Promise.resolve();
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  /**
   * This integration's OAuth capability view. Defaults to null; OAuth-capable
   * integrations override this getter to return `this`.
   */
  get oauth(): IOAuthIntegration | null {
    return null;
  }

  /**
   * Default to tearing down on a dependency failure. Safe when nothing is
   * known about what the integration holds: see DependencyFailurePolicy.
   */
  get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.STOP;
  }

  /** No dependencies; an integration that has some overrides this to return them. */
  getDependencies(): IIntegration[] {
    return [];
  }

  /** Not in a group; an integration that belongs to one overrides this. */
  getGroup(): IntegrationGroup | null {
    return null;
  }

  getStatus(): IntegrationStatus {
    return this.status;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  reportError(message: string): void {
    this.setStatus(IntegrationStatus.ERROR, message);
  }

  reportBlocked(reason: string): void {
    this.setStatus(IntegrationStatus.BLOCKED, reason);
  }

  on<K extends keyof IntegrationEvents>(
    event: K,
    handler: (...args: IntegrationEvents[K]) => void
  ): void {
    // EventEmitter's own on() can't relate a generic K to its listener type.
    this.events.on(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Check a stored config against `schema`, throwing an error that names every field that was
   * wrong. Called from initialize(), so a bad config fails when it is loaded or saved rather than
   * at whatever later moment first reads the bad field.
   */
  protected parseConfig<T>(schema: z.ZodType<T>, stored: unknown): T {
    const result = schema.safeParse(stored);
    if (!result.success) {
      throw new Error(`Invalid ${this.name} config:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
  }

  /**
   * Set integration status and emit event so IntegrationManager can forward it.
   */
  protected setStatus(status: IntegrationStatus, errorMessage?: string): void {
    this.status = status;
    this.errorMessage = BaseIntegration.STATUSES_WITH_MESSAGE.has(status)
      ? errorMessage
      : undefined;
    this.events.emit('status', status);
  }

  /**
   * Announce that this integration's OAuth credentials were just rotated.
   *
   * A refresh is deliberately *not* a status change — the integration stays
   * CONNECTED throughout — so `integration.status` can't express it. This is
   * a courtesy notification for anything that might want to react; nothing is
   * required to. It carries no credentials: the expiry is the only fact a
   * consumer could act on, and anything needing the token itself should ask
   * the integration for it on access.
   */
  protected reportTokenRefreshed(expiresAt?: number): void {
    this.events.emit('tokenRefreshed', expiresAt === undefined ? {} : { expiresAt });
  }

  /**
   * Report a failure that doesn't change this integration's status, so
   * IntegrationManager can log it and publish it as `integration.error`.
   * Takes whatever was caught and converts it, so listeners get an Error.
   */
  protected reportFailure(error: unknown): void {
    this.events.emit('failure', toError(error));
  }
}
