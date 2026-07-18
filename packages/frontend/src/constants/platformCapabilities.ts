import { Platform, PlatformCapability } from '@turingmod/shared';

/**
 * Which capabilities each platform supports, mirroring the backend platform façades
 * (TwitchPlatform.getCapabilities / YouTubePlatform.getCapabilities). Kept in sync manually — the
 * backend is the source of truth. Used to hide commands a platform can't run in the simulator.
 */
export const PLATFORM_CAPABILITIES: Record<Platform, ReadonlySet<PlatformCapability>> = {
  [Platform.TWITCH]: new Set([
    PlatformCapability.SEND_CHAT,
    PlatformCapability.SET_TITLE,
    PlatformCapability.SET_GAME,
    PlatformCapability.SET_TAGS,
    PlatformCapability.UPTIME,
    PlatformCapability.ADS,
    PlatformCapability.SCHEDULE,
    PlatformCapability.CONTENT_LABELS,
    PlatformCapability.FOLLOW_INFO,
  ]),
  [Platform.YOUTUBE]: new Set([
    PlatformCapability.SEND_CHAT,
    PlatformCapability.SET_TITLE,
    PlatformCapability.UPTIME,
  ]),
};

/**
 * True if a command is available on a platform — i.e. all of its requiredCapabilities are
 * supported by that platform.
 */
export function isCommandAvailableOnPlatform(
  requiredCapabilities: PlatformCapability[],
  platform: Platform
): boolean {
  const capabilities = PLATFORM_CAPABILITIES[platform];
  return requiredCapabilities.every((capability) => capabilities.has(capability));
}
