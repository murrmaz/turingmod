import { z } from 'zod';
import type { SettingsDefinition } from '../database/repositories/SettingsRepository.js';

const EffectSettingsSchema = z.strictObject({
  /** Name of the OBS source the facecam effects animate. */
  facecamSource: z.string().min(1).default('Facecam'),
});

export type EffectSettings = z.infer<typeof EffectSettingsSchema>;

/** The facecam effect settings, stored under the `effects` key. */
export const EFFECT_SETTINGS: SettingsDefinition<EffectSettings> = {
  key: 'effects',
  schema: EffectSettingsSchema,
};
