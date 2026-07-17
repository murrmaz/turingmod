import { IntegrationStatus } from '@turingmod/shared';
import sound from 'sound-play';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';

interface SoundPlayEvent {
  filePath: string;
  volume?: number;
}

export class SoundIntegration extends BaseIntegration {
  readonly name = 'sound';
  readonly version = '1.0.0';

  private unsubscribe: (() => void) | undefined;

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    super(logger, { component: 'SoundIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Sound integration initialized');
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.unsubscribe = this.eventBus.on<SoundPlayEvent>('sound.play', (data) => {
      this.playSound(data.filePath, data.volume);
    });

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.info('Sound integration started');
    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.info('Sound integration stopped');
    return Promise.resolve();
  }

  async playSound(filePath: string, volume?: number): Promise<void> {
    this.logger.info('Playing sound', { filePath, volume });

    try {
      await sound.play(filePath, volume);
      this.logger.debug('Sound playback completed', { filePath });
    } catch (error) {
      this.logger.error('Sound playback failed', error, { filePath });
      this.emitError(error);
    }
  }
}
