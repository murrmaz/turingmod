import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';

/**
 * Discord integration (placeholder)
 * TODO: Implement Discord webhook/bot integration
 */
export class DiscordIntegration extends BaseIntegration {
  readonly name = 'discord';
  readonly version = '1.0.0';

  constructor(
    _eventBus: EventBus, // Reserved for future use
    logger: Logger
  ) {
    super(logger, { component: 'DiscordIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Discord integration initialized (placeholder)');
    // TODO: Initialize Discord client
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Discord integration started (placeholder)');
    this.setStatus(IntegrationStatus.CONNECTED);
    // TODO: Connect to Discord
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Discord integration stopped');
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }
}
