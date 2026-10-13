import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';
import {
  DependencyFailurePolicy,
  type IIntegration,
  type IntegrationEvents,
} from './interfaces/IIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

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

  abstract initialize(config: Record<string, unknown>): Promise<void>;
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
   */
  protected reportFailure(error: unknown): void {
    this.events.emit('failure', error);
  }
}
