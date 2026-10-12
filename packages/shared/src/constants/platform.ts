/** Streaming platforms TuringMod can operate on. */
export enum StreamingPlatform {
  TWITCH = 'twitch',
  YOUTUBE = 'youtube',
  // TIKTOK = 'tiktok', // future
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
  BROADCASTER_ABOUT = 'broadcaster_about', // Twitch only (channel bio/description lookups)
  SHOUTOUT = 'shoutout', // Twitch only (native /shoutout)
  CHANNEL_POINTS = 'channel_points', // Twitch only (custom rewards and their redemptions)
  MODERATION = 'moderation', // Twitch only for now (timeouts, deleting messages)
  CLIPS = 'clips', // Twitch only (clip lookups)
}
