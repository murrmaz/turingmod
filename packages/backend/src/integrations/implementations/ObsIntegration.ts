import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import OBSWebSocket from 'obs-websocket-js';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import type { IIntegration } from '../interfaces/IIntegration.js';

interface ObsConfig {
  url: string | undefined;
  password: string | undefined;
}

const DEFAULT_OBS_URL = 'ws://127.0.0.1:4455';

export class ObsIntegration implements IIntegration {
  readonly name = 'obs';
  readonly version = '1.0.0';

  private status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  private errorMessage: string | undefined;
  private events = new EventEmitter();
  private logger: Logger;
  private obs: OBSWebSocket = new OBSWebSocket();
  private config: ObsConfig = { url: undefined, password: undefined };

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ObsIntegration' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      url: (config.url as string | undefined) ?? DEFAULT_OBS_URL,
      password: config.password as string | undefined,
    };

    this.logger.info('OBS integration initialized', { url: this.config.url });
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.logger.info('Starting OBS integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      await this.obs.connect(this.config.url, this.config.password);

      this.subscribeToObsEvents();

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('OBS integration started successfully');
    } catch (error) {
      this.logger.error('Failed to connect to OBS', { error });
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Failed to connect to OBS'
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping OBS integration');

    this.obs.removeAllListeners();
    await this.obs.disconnect();

    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.info('OBS integration stopped');
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
   * Get the underlying OBSWebSocket client for direct use by commands.
   * Use `client.call(requestType, requestData)` to send any OBS request.
   */
  getClient(): OBSWebSocket {
    return this.obs;
  }

  private setStatus(status: IntegrationStatus, errorMessage?: string): void {
    this.status = status;
    this.errorMessage = status === IntegrationStatus.ERROR ? errorMessage : undefined;

    this.events.emit('status', status);
    this.eventBus.emit('integration.status', {
      name: this.name,
      status,
      lastConnected: status === IntegrationStatus.CONNECTED ? Date.now() : undefined,
      errorMessage: this.errorMessage,
    });
  }

  private subscribeToObsEvents(): void {
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      this.logger.debug('Scene changed', { sceneName: data.sceneName });
      this.eventBus.emit('obs.scene.changed', data);
    });

    this.obs.on('StreamStateChanged', (data) => {
      this.logger.debug('Stream state changed', { outputState: data.outputState });
      this.eventBus.emit('obs.stream.stateChanged', data);
    });

    this.obs.on('RecordStateChanged', (data) => {
      this.logger.debug('Record state changed', { outputState: data.outputState });
      this.eventBus.emit('obs.record.stateChanged', data);
    });

    this.obs.on('SceneItemEnableStateChanged', (data) => {
      this.logger.debug('Scene item state changed', data);
      this.eventBus.emit('obs.sceneItem.stateChanged', data);
    });

    this.obs.on('ConnectionClosed', () => {
      this.logger.warn('OBS connection closed unexpectedly');
      this.setStatus(IntegrationStatus.DISCONNECTED);
    });

    this.obs.on('ConnectionError', (error) => {
      this.logger.error('OBS connection error', { error });
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Connection error'
      );
    });
  }
}
