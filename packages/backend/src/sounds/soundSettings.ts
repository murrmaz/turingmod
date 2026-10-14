import { z } from 'zod';
import type { SettingsDefinition } from '../database/repositories/SettingsRepository.js';

const SoundSettingsSchema = z.strictObject({
  /** Directory clip names are looked up in; null for the bundled `packages/backend/data`. */
  directory: z.string().min(1).nullable().default(null),
  /** Playback volume, 0–1. */
  volume: z.number().min(0).max(1).default(0.5),
});

export type SoundSettings = z.infer<typeof SoundSettingsSchema>;

/** The sound settings, stored under the `sounds` key. */
export const SOUND_SETTINGS: SettingsDefinition<SoundSettings> = {
  key: 'sounds',
  schema: SoundSettingsSchema,
};
