import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import type { IIntegration } from '../interfaces/IIntegration.js';

/**
 * Spotify integration (placeholder)
 * TODO: Implement Spotify Web API integration
 */
export class SpotifyIntegration implements IIntegration {
  readonly name = 'spotify';
  readonly version = '1.0.0';

  private status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  private events = new EventEmitter();
  private logger: Logger;

  constructor(
    _eventBus: EventBus, // Reserved for future use
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'SpotifyIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Spotify integration initialized (placeholder)');
    // TODO: Initialize Spotify API client
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Spotify integration started (placeholder)');
    this.status = IntegrationStatus.CONNECTED;
    // TODO: Connect to Spotify
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Spotify integration stopped');
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
