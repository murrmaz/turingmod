import { z } from 'zod';

/**
 * Integration connection status
 */
export enum IntegrationStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  /** Was connected, but token refresh failed — needs the user to redo the OAuth flow. */
  NEEDS_REAUTH = 'needs_reauth',
  /**
   * Can't run because a declared dependency isn't connected. Distinct from
   * ERROR: nothing is broken, a prerequisite is just off or still starting.
   */
  BLOCKED = 'blocked',
}

/**
 * Every integration's name, as the backend registers it and the console asks for it (start, stop,
 * configure, authorize).
 */
export enum IntegrationName {
  TWITCH_AUTH = 'twitch-auth',
  TWITCH_API = 'twitch-api',
  TWITCH_EVENTSUB = 'twitch-eventsub',
  YOUTUBE_AUTH = 'youtube-auth',
  YOUTUBE_API = 'youtube-api',
  YOUTUBE_CHAT = 'youtube-chat',
  SPOTIFY_AUTH = 'spotify-auth',
  SPOTIFY_API = 'spotify-api',
  OBS = 'obs',
  SOUND = 'sound',
  DISCORD = 'discord',
  ARDUINO = 'arduino',
}

/** Logical grouping of related integrations for UI display (e.g. Twitch's auth/api/eventsub trio). */
export enum IntegrationGroup {
  TWITCH = 'twitch',
  YOUTUBE = 'youtube',
  SPOTIFY = 'spotify',
}

/**
 * Integration information
 */
export interface IntegrationInfo {
  /** Unique integration name */
  name: string;

  /** Current connection status */
  status: IntegrationStatus;

  /**
   * Whether the streamer wants it running: set by starting it from the console (or authorizing
   * it), cleared by stopping it. An enabled integration starts at boot and comes back after a
   * dependency recovers; it may still be BLOCKED while it waits for one.
   */
  enabled: boolean;

  /** Explanation if status is ERROR, NEEDS_REAUTH or BLOCKED, or why it is still CONNECTING */
  errorMessage?: string;

  /** Additional integration-specific metadata */
  metadata?: {
    /** Array of integration names this integration depends on */
    dependencies?: string[];
    [key: string]: unknown;
  };

  /** OAuth capability info, present only if this integration supports OAuth */
  oauth?: {
    /** HTTP callback path this integration's OAuth flow completes on */
    callbackPath: string;
    /**
     * The full redirect URI the provider sends the browser back to. Derived by the backend from
     * its port and the provider's loopback host; the user registers this exact value with the
     * provider.
     */
    redirectUri: string;
    /**
     * Whether client credentials have been entered. Until they are, connecting means opening the
     * setup dialog rather than the provider's authorization page.
     */
    configured: boolean;
  };

  /**
   * Where it connects, for an integration whose address is a setting (the Arduino's), so its
   * setup dialog can show the one in use. Absent for the others.
   */
  address?: string;

  /** Logical group this integration belongs to, for grouping related integrations in the UI. Absent for standalone integrations (Discord, OBS, Arduino, Sound). */
  group?: IntegrationGroup;
}

/**
 * The client credentials an OAuth integration's setup dialog saves. The backend's stored config
 * extends this with the provider's token fields.
 */
export const OAuthClientCredentialsSchema = z.strictObject({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type OAuthClientCredentials = z.infer<typeof OAuthClientCredentialsSchema>;
