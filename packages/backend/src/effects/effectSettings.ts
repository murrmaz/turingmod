/** `settings` table key the facecam effect settings are stored under. */
export const EFFECT_SETTINGS_KEY = 'effects';

export interface EffectSettings {
  /** Name of the OBS source the facecam effects animate. */
  facecamSource: string;
}

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = { facecamSource: 'Facecam' };

/** Read stored settings, keeping valid fields and defaulting the rest. */
export function parseEffectSettings(raw: unknown): EffectSettings {
  const source =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>).facecamSource
      : undefined;
  return {
    facecamSource:
      typeof source === 'string' && source.trim() !== ''
        ? source
        : DEFAULT_EFFECT_SETTINGS.facecamSource,
  };
}
