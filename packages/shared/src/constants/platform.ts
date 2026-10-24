/** Streaming platforms TuringMod can operate on. */
export enum StreamingPlatform {
  TWITCH = 'twitch',
  YOUTUBE = 'youtube',
  // TIKTOK = 'tiktok', // future
}

/** Human-readable display names for platforms, in chat replies and in the console alike. */
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

/**
 * Capabilities a platform may support. A command is available on a platform only if the
 * platform's capability set is a superset of the command's requiredCapabilities.
 */
export enum PlatformCapability {
  SEND_CHAT = 'send_chat', // baseline: can post a chat message (all platforms)
  SET_TITLE = 'set_title', // Twitch + YouTube
  SET_GAME = 'set_game', // Twitch only (category model)
  SET_TAGS = 'set_tags', // Twitch only
  UPTIME = 'uptime', // Twitch + YouTube (has a broadcast start time)
  ADS = 'ads', // Twitch only
  SCHEDULE = 'schedule', // Twitch only
  CONTENT_LABELS = 'content_labels', // Twitch only
  FOLLOW_INFO = 'follow_info', // Twitch only (follow age lookups)
  ACCOUNT_AGE = 'account_age', // Twitch only (when a viewer's account was created)
  BROADCASTER_ABOUT = 'broadcaster_about', // Twitch only (channel bio/description lookups)
  SHOUTOUT = 'shoutout', // Twitch only (native /shoutout)
  CHANNEL_POINTS = 'channel_points', // Twitch only (custom rewards and their redemptions)
  MODERATION = 'moderation', // Twitch only for now (timeouts, deleting messages)
  CLIPS = 'clips', // Twitch only (clip lookups)
  MARKERS = 'markers', // Twitch only (stream markers)
  VODS = 'vods', // Twitch only (deleting past broadcasts)
  ANNOUNCEMENTS = 'announcements', // Twitch only (highlighted chat announcements)
}
