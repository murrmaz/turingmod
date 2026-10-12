import type { PlatformCapability, StreamingPlatform } from '@turingmod/shared';

/**
 * Platform-agnostic stream metadata. Fields the platform has no concept of are omitted.
 */
export interface StreamInfo {
  title: string;
  game?: string; // category/game name where the platform has one
  tags?: string[];
}

/**
 * Ad-break state for a live broadcast. A null `nextAdDate` means the platform is live but has
 * no ad scheduled (or won't say), which is distinct from the stream being offline entirely —
 * callers get `null` instead of this object in that case.
 */
export interface AdBreakInfo {
  nextAdDate: Date | null;
}

/**
 * One upcoming scheduled broadcast, in platform-agnostic form.
 */
export interface ScheduleSegment {
  startDate: Date;
  title?: string;
  category?: string;
}

/**
 * Outcome of a shoutout. The platform may decline to send one because of its own rate limits;
 * `retryAfterMs` says when it would next accept.
 */
export interface ShoutoutResult {
  sent: boolean;
  reason?: 'global_cooldown' | 'target_cooldown';
  retryAfterMs?: number;
}

/** The fields of a channel point reward that TuringMod sets. */
export interface ChannelRewardSettings {
  title: string;
  cost: number;
  /** Shown to the viewer when redeeming; empty for none. */
  prompt: string;
  userInputRequired: boolean;
  /** Seconds between redemptions by anyone; null for no cooldown. */
  globalCooldownSeconds: number | null;
  /** Null for no limit. */
  maxPerStream: number | null;
  /** Null for no limit. */
  maxPerUserPerStream: number | null;
  /** Skip the request queue. A redemption that skipped it can't be refunded afterwards. */
  autoFulfill: boolean;
}

/** A channel point reward as it currently exists on the channel. */
export interface ChannelReward extends ChannelRewardSettings {
  id: string;
  isEnabled: boolean;
  isPaused: boolean;
  /**
   * Whether this application may edit the reward and its redemptions. Only the application
   * that created a reward can; one made in the dashboard or by another bot is read-only.
   */
  manageable: boolean;
}

/** Changes to apply to an existing reward. */
export type ChannelRewardChanges = Partial<ChannelRewardSettings> & { isPaused?: boolean };

/** How a queued redemption ends: completed, or canceled with the viewer's points refunded. */
export type RedemptionOutcome = 'fulfilled' | 'canceled';

/**
 * Platform-agnostic façade over one streaming platform. Implemented by TwitchPlatform and
 * YouTubePlatform, each delegating to that platform's integration trio. Capability-guarded
 * methods are optional; callers must check getCapabilities() (or go through
 * StreamControlService, which does).
 */
export interface IStreamPlatform {
  readonly platform: StreamingPlatform;

  /** Which PlatformCapabilities this platform currently supports. */
  getCapabilities(): Set<PlatformCapability>;

  /**
   * Null when this platform can be acted on, otherwise a human-readable reason it can't
   * (OAuth never completed, authorization revoked, connection failed).
   *
   * Exists so callers that must not surface auth problems to chat — a mirrored write replies
   * in public, where the broadcaster's token state doesn't belong — can still tell "skipped
   * because offline" apart from "skipped because broken", and log the latter.
   */
  getUnavailableReason(): string | null;

  /** True if the platform is connected AND currently broadcasting. */
  isLive(): Promise<boolean>;

  /** Post a message to this platform's own chat. Reply routing (Phase 5) uses this. */
  sendChatMessage(message: string): Promise<void>;

  /** Read current stream metadata. Throws if not connected. */
  getStreamInfo(): Promise<StreamInfo>;

  /** Apply metadata changes the platform supports; ignores fields it can't set. */
  setStreamInfo(info: Partial<StreamInfo>): Promise<void>;

  /** Milliseconds the current broadcast has been live, or null if offline. */
  getUptime(): Promise<number | null>;

  /**
   * Ad-break state for the current broadcast, or null if the stream is offline.
   * Requires PlatformCapability.ADS.
   */
  getNextAdBreak?(): Promise<AdBreakInfo | null>;

  /**
   * Upcoming scheduled broadcasts, soonest first; empty if none.
   * Requires PlatformCapability.SCHEDULE.
   */
  getSchedule?(): Promise<ScheduleSegment[]>;

  /**
   * Content classification labels currently set on the channel.
   * Requires PlatformCapability.CONTENT_LABELS.
   */
  getContentLabels?(): Promise<string[]>;

  /**
   * Replace the channel's content classification labels.
   * Requires PlatformCapability.CONTENT_LABELS.
   */
  setContentLabels?(labels: string[]): Promise<void>;

  /**
   * The broadcaster's channel bio/description, or null if unset.
   * Requires PlatformCapability.BROADCASTER_ABOUT.
   */
  getBroadcasterAbout?(): Promise<string | null>;

  /**
   * Send the platform's native shoutout for another channel, by its login name.
   * Requires PlatformCapability.SHOUTOUT.
   */
  shoutout?(channelName: string): Promise<ShoutoutResult>;

  /** Every channel point reward on the channel. Requires PlatformCapability.CHANNEL_POINTS. */
  getChannelRewards?(): Promise<ChannelReward[]>;

  /** Create an enabled reward. Requires PlatformCapability.CHANNEL_POINTS. */
  createChannelReward?(settings: ChannelRewardSettings): Promise<ChannelReward>;

  /** Update a reward this application created. Requires PlatformCapability.CHANNEL_POINTS. */
  updateChannelReward?(rewardId: string, changes: ChannelRewardChanges): Promise<void>;

  /**
   * Complete or cancel a redemption waiting in the request queue, for a reward this application
   * created. Requires PlatformCapability.CHANNEL_POINTS.
   */
  resolveRedemption?(
    rewardId: string,
    redemptionId: string,
    outcome: RedemptionOutcome
  ): Promise<void>;
}
