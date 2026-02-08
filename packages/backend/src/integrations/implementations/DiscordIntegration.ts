import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import type { IIntegration } from '../interfaces/IIntegration.js';

/**
 * Discord integration (placeholder)
 * TODO: Implement Discord webhook/bot integration
 */
export class DiscordIntegration implements IIntegration {
  readonly name = 'discord';
  readonly version = '1.0.0';

  private status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  private events = new EventEmitter();
  private logger: Logger;

  constructor(
    _eventBus: EventBus, // Reserved for future use
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'DiscordIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Discord integration initialized (placeholder)');
    // TODO: Initialize Discord client
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Discord integration started (placeholder)');
    this.status = IntegrationStatus.CONNECTED;
    // TODO: Connect to Discord
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Discord integration stopped');
    this.status = IntegrationStatus.DISCONNECTED;
    return Promise.resolve();
  }

  getStatus(): IntegrationStatus {
    return this.status;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.events.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.events.off(event, handler);
  }
}
