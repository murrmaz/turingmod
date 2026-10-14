import type {
  EmptyPayload,
  IntegrationConfigurePayload,
  IntegrationListPayload,
  IntegrationStartPayload,
  IntegrationStopPayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { createErrorMessage, MessageType, messageOf } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { IntegrationManager } from '../../integrations/IntegrationManager.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Integration message handler
 * Handles integration control and status requests
 */
@injectable()
@singleton()
export class IntegrationHandler {
  private logger: Logger;

  constructor(
    private integrationManager: IntegrationManager,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'IntegrationHandler' });
  }

  /**
   * Handle integration start message
   */
  async handleStart(
    message: IWebSocketMessage<IntegrationStartPayload>
  ): Promise<IWebSocketMessage | null> {
    const { integrationName } = message.payload;

    this.logger.info(`Starting integration: ${integrationName}`);

    try {
      await this.integrationManager.enableIntegration(integrationName);

      // Get updated status and return with request ID so frontend can match response
      const status = this.integrationManager.getStatus(integrationName);
      if (status) {
        return {
          id: message.id, // Use request ID for response matching
          type: MessageType.INTEGRATION_STATUS,
          timestamp: Date.now(),
          payload: {
            integration: status,
          },
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to start integration: ${integrationName}`, error);

      return createErrorMessage(
        'INTEGRATION_START_FAILED',
        messageOf(error, 'Failed to start integration'),
        message.id
      );
    }
  }

  /**
   * Handle integration stop message
   */
  async handleStop(
    message: IWebSocketMessage<IntegrationStopPayload>
  ): Promise<IWebSocketMessage | null> {
    const { integrationName } = message.payload;

    this.logger.info(`Stopping integration: ${integrationName}`);

    try {
      await this.integrationManager.disableIntegration(integrationName);

      // Get updated status and return with request ID so frontend can match response
      const status = this.integrationManager.getStatus(integrationName);
      if (status) {
        return {
          id: message.id, // Use request ID for response matching
          type: MessageType.INTEGRATION_STATUS,
          timestamp: Date.now(),
          payload: {
            integration: status,
          },
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to stop integration: ${integrationName}`, error);

      return createErrorMessage(
        'INTEGRATION_STOP_FAILED',
        messageOf(error, 'Failed to stop integration'),
        message.id
      );
    }
  }

  /**
   * Handle integration list request
   */
  handleList(
    message: IWebSocketMessage<EmptyPayload>
  ): Promise<IWebSocketMessage<IntegrationListPayload>> {
    this.logger.debug('Getting integration list');

    const integrations = this.integrationManager.getAllStatuses();

    return Promise.resolve({
      id: message.id,
      type: MessageType.INTEGRATION_LIST,
      timestamp: Date.now(),
      payload: {
        integrations,
      },
    });
  }

  /**
   * Handle integration configure message
   */
  async handleConfigure(
    message: IWebSocketMessage<IntegrationConfigurePayload>
  ): Promise<IWebSocketMessage | null> {
    const { integrationName, config } = message.payload;

    this.logger.info(`Configuring integration: ${integrationName}`);

    try {
      await this.integrationManager.configureIntegration(integrationName, config);

      // Get updated status and return with correct message ID
      const status = this.integrationManager.getStatus(integrationName);
      if (status) {
        return {
          id: message.id, // Use request ID so frontend can match response
          type: MessageType.INTEGRATION_STATUS,
          timestamp: Date.now(),
          payload: {
            integration: status,
          },
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to configure integration: ${integrationName}`, error);

      return createErrorMessage(
        'INTEGRATION_CONFIGURE_FAILED',
        messageOf(error, 'Failed to configure integration'),
        message.id
      );
    }
  }
}
