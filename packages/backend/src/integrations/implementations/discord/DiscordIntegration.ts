import { IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';

/**
 * Discord integration (placeholder)
 * TODO: Implement Discord webhook/bot integration
 */
@singleton()
export class DiscordIntegration extends BaseIntegration {
  readonly name = 'discord';

  constructor(
    _eventBus: EventBus, // Reserved for future use
    logger: Logger
  ) {
    super(logger, { component: 'DiscordIntegration' });
  }

  start(): Promise<void> {
    // Not implemented yet, so it stays DISCONNECTED rather than claiming a connection.
    this.logger.info('Discord integration is not implemented yet');
    // TODO: Connect to Discord
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.debug('Discord integration stopped');
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }
}
