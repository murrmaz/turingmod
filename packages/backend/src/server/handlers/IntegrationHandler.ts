import type {
  IWebSocketMessage,
  IntegrationConfigurePayload,
  IntegrationListPayload,
  IntegrationStartPayload,
  IntegrationStopPayload,
} from '@turingmod/shared';
import { MessageType, createErrorMessage } from '@turingmod/shared';
import type { IntegrationManager } from '../../integrations/IntegrationManager.js';
import type { Logger } from '../../utils/Logger.js';

/**
 * Integration message handler
 * Handles integration control and status requests
 */
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
      await this.integrationManager.startIntegration(integrationName);

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
        error instanceof Error ? error.message : 'Failed to start integration',
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
      await this.integrationManager.stopIntegration(integrationName);

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
        error instanceof Error ? error.message : 'Failed to stop integration',
        message.id
      );
    }
  }

  /**
   * Handle integration list request
   */
  handleList(message: IWebSocketMessage): Promise<IWebSocketMessage<IntegrationListPayload>> {
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
      await this.integrationManager.configureIntegration(
        integrationName,
        config,
        false // disabled until OAuth completes
      );

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
        error instanceof Error ? error.message : 'Failed to configure integration',
        message.id
      );
    }
  }
}
