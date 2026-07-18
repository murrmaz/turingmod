import { Platform } from '@turingmod/shared';

/** Human-readable display names for platforms, used when composing chat replies. */
const PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  [Platform.TWITCH]: 'Twitch',
  [Platform.YOUTUBE]: 'YouTube',
};

/** Format a platform for display, e.g. `Platform.TWITCH` → `Twitch`. */
export function platformDisplayName(platform: Platform): string {
  return PLATFORM_DISPLAY_NAMES[platform];
}

/** Format a list of platforms for display, e.g. `Twitch, YouTube`. */
export function formatPlatformList(platforms: Platform[]): string {
  return platforms.map(platformDisplayName).join(', ');
}
