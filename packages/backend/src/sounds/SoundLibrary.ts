import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import { SoundIntegration } from '../integrations/implementations/sound/SoundIntegration.js';
import { Logger } from '../utils/Logger.js';
import { DATA_DIRECTORY } from '../utils/paths.js';
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

  constructor(
    private sound: SoundIntegration,
    private settingsRepo: SettingsRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'SoundLibrary' });
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

  /** Play a clip if possible, logging rather than throwing when it can't be. */
  async tryPlay(name: string, options: { maxDurationMs?: number } = {}): Promise<void> {
    try {
      await this.play(name, options);
    } catch (error) {
      this.logger.warn(`Could not play "${name}": ${messageOf(error)}`);
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
