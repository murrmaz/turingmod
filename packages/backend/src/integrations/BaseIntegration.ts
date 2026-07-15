import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';
import type { IIntegration } from './interfaces/IIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

/**
 * Shared status/error/event-emitter plumbing for IIntegration implementations.
 * Concrete integrations implement initialize/start/stop and call setStatus()
 * to report lifecycle transitions.
 */
export abstract class BaseIntegration implements IIntegration {
  abstract readonly name: string;
  abstract readonly version: string;

  protected status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  protected errorMessage: string | undefined;
  protected readonly events = new EventEmitter();
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

  getStatus(): IntegrationStatus {
    return this.status;
  }

  getErrorMessage(): string | undefined {
    return this.errorMessage;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.events.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.events.off(event, handler);
  }

  /**
   * Set integration status and emit event so IntegrationManager can forward it.
   */
  protected setStatus(status: IntegrationStatus, errorMessage?: string): void {
    this.status = status;
    this.errorMessage = status === IntegrationStatus.ERROR ? errorMessage : undefined;
    this.events.emit('status', status);
  }

  /**
   * Emit an error event so IntegrationManager can log/forward it.
   */
  protected emitError(error: unknown): void {
    this.events.emit('error', error);
  }
}
