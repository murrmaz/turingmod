import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';

/**
 * Arduino integration (placeholder)
 * TODO: Implement serial port communication
 */
export class ArduinoIntegration extends BaseIntegration {
  readonly name = 'arduino';
  readonly version = '1.0.0';

  constructor(
    _eventBus: EventBus, // Reserved for future use
    logger: Logger
  ) {
    super(logger, { component: 'ArduinoIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Arduino integration initialized (placeholder)');
    // TODO: Initialize serial port connection
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.logger.info('Arduino integration started (placeholder)');
    this.setStatus(IntegrationStatus.CONNECTED);
    // TODO: Open serial port
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.info('Arduino integration stopped');
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }
}
