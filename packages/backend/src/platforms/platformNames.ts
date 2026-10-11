import { StreamingPlatform } from '@turingmod/shared';

/** Human-readable display names for platforms, used when composing chat replies. */
const PLATFORM_DISPLAY_NAMES: Record<StreamingPlatform, string> = {
  [StreamingPlatform.TWITCH]: 'Twitch',
  [StreamingPlatform.YOUTUBE]: 'YouTube',
};

/** Format a platform for display, e.g. `StreamingPlatform.TWITCH` → `Twitch`. */
export function platformDisplayName(platform: StreamingPlatform): string {
  return PLATFORM_DISPLAY_NAMES[platform];
}

/** Format a list of platforms for display, e.g. `Twitch, YouTube`. */
export function formatPlatformList(platforms: StreamingPlatform[]): string {
  return platforms.map(platformDisplayName).join(', ');
}
