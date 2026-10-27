import { z } from 'zod';
import type { SettingsDefinition } from '../database/repositories/SettingsRepository.js';

/**
 * The facecam's OBS source name until a setting says otherwise. Breaks hide it by default too, so
 * a rename starts from one name.
 */
export const DEFAULT_FACECAM_SOURCE = 'Facecam';

const EffectSettingsSchema = z.strictObject({
  /** Name of the OBS source the facecam effects animate. */
  facecamSource: z.string().min(1).default(DEFAULT_FACECAM_SOURCE),
});

export type EffectSettings = z.infer<typeof EffectSettingsSchema>;

/** The facecam effect settings, stored under the `effects` key. */
export const EFFECT_SETTINGS: SettingsDefinition<EffectSettings> = {
  key: 'effects',
  schema: EffectSettingsSchema,
};
