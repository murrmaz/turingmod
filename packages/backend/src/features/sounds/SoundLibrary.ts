import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import type { RepeatingFailures } from '../../core/failures.js';
import { repeatingFailures } from '../../core/failures.js';
import { SettingsRepository } from '../../database/repositories/SettingsRepository.js';
import { SoundIntegration } from '../../integrations/implementations/sound/SoundIntegration.js';
import { Logger } from '../../utils/Logger.js';
import { DATA_DIRECTORY } from '../../utils/paths.js';
import { SOUND_SETTINGS } from './soundSettings.js';

/**
 * Plays sound clips by name. Names are looked up in the library directory (the `sounds`
 * setting, defaulting to `packages/backend/data`); an absolute path is used as-is.
 *
 * `play()` checks up front that sound is running and the clip exists, and rejects if not, so a
 * reward whose whole point is the sound gets refunded. It doesn't wait for the clip to finish.
 */
@singleton()
export class SoundLibrary {
  private logger: Logger;
  private failures: RepeatingFailures;

  constructor(
    private sound: SoundIntegration,
    private settingsRepo: SettingsRepository,
    eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'SoundLibrary' });
    this.failures = repeatingFailures(eventBus, this.logger, 'Sounds');
  }

  /** The absolute path a clip name refers to. */
  resolve(name: string): string {
    if (isAbsolute(name)) return name;
    const { directory } = this.settings();
    return join(directory ?? DATA_DIRECTORY, name);
  }

  /**
   * Start playing a clip.
   * @param options.maxDurationMs Cut it off after this long.
   */
  async play(name: string, options: { maxDurationMs?: number } = {}): Promise<void> {
    if (this.sound.getStatus() !== IntegrationStatus.CONNECTED) {
      throw new Error('Sound is not running');
    }
    const path = this.resolve(name);
    try {
      await access(path);
    } catch {
      throw new Error(`Sound clip not found: ${path}`);
    }

    const { volume } = this.settings();
    void this.sound.playSound(path, volume, options.maxDurationMs);
  }

  /**
   * Play a clip if possible, without throwing when it can't be. Sound not running is only logged,
   * since the Sound integration's status already shows it. Anything else, such as a missing or
   * misnamed clip, is reported, once per clip until it plays again: nothing else would tell the
   * streamer why `!bonk` makes no sound.
   */
  async tryPlay(name: string, options: { maxDurationMs?: number } = {}): Promise<void> {
    if (this.sound.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.debug(`Not playing "${name}": sound is not running`);
      return;
    }
    try {
      await this.play(name, options);
      this.failures.recovered(name);
    } catch (error) {
      this.failures.failed(name, `Could not play the sound "${name}".`, error);
    }
  }

  /** Cut off every sound that is playing. */
  stopAll(): void {
    this.sound.stopAll();
  }

  private settings() {
    return this.settingsRepo.get(SOUND_SETTINGS);
  }
}
