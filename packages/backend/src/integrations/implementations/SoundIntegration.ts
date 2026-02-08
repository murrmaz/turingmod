import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import sound from 'sound-play';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import type { IIntegration } from '../interfaces/IIntegration.js';

interface SoundPlayEvent {
  filePath: string;
  volume?: number;
}

export class SoundIntegration implements IIntegration {
  readonly name = 'sound';
  readonly version = '1.0.0';

  private status: IntegrationStatus = IntegrationStatus.DISCONNECTED;
  private events = new EventEmitter();
  private logger: Logger;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'SoundIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Sound integration initialized');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.unsubscribe = this.eventBus.on<SoundPlayEvent>('sound.play', (data) => {
      this.playSound(data.filePath, data.volume);
    });

    this.status = IntegrationStatus.CONNECTED;
    this.events.emit('status', this.status);
    this.logger.info('Sound integration started');
    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    this.status = IntegrationStatus.DISCONNECTED;
    this.events.emit('status', this.status);
    this.logger.info('Sound integration stopped');
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

  async playSound(filePath: string, volume?: number): Promise<void> {
    this.logger.info('Playing sound', { filePath, volume });

    try {
      await sound.play(filePath, volume);
      this.logger.debug('Sound playback completed', { filePath });
    } catch (error) {
      this.logger.error('Sound playback failed', { filePath, error });
      this.events.emit('error', error);
    }
  }
}
