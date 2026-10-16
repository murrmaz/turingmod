import { IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';

/**
 * Arduino integration (placeholder)
 * TODO: Implement serial port communication
 */
@singleton()
export class ArduinoIntegration extends BaseIntegration {
  readonly name = 'arduino';
  override readonly placeholder = true;

  constructor(
    _eventBus: EventBus, // Reserved for future use
    logger: Logger
  ) {
    super(logger, { component: 'ArduinoIntegration' });
  }

  start(): Promise<void> {
    // Not implemented yet, so it stays DISCONNECTED rather than claiming a connection.
    this.logger.info('Arduino integration is not implemented yet');
    // TODO: Open serial port
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.debug('Arduino integration stopped');
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }
}
