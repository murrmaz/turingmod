/** `settings` table key the sound settings are stored under. */
export const SOUND_SETTINGS_KEY = 'sounds';

export interface SoundSettings {
  /** Directory clip names are looked up in; null for the bundled `packages/backend/data`. */
  directory: string | null;
  /** Playback volume, 0–1. */
  volume: number;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { directory: null, volume: 0.5 };

/** Read stored settings, keeping valid fields and defaulting the rest. */
export function parseSoundSettings(raw: unknown): SoundSettings {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { directory, volume } = record;
  return {
    directory:
      typeof directory === 'string' && directory.trim() !== ''
        ? directory
        : DEFAULT_SOUND_SETTINGS.directory,
    volume:
      typeof volume === 'number' && volume >= 0 && volume <= 1
        ? volume
        : DEFAULT_SOUND_SETTINGS.volume,
  };
}
