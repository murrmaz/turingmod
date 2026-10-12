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

/** A clip of a stream. */
export interface ClipInfo {
  id: string;
  url: string;
  title: string;
  /** Who clipped it. */
  creatorName: string;
  /** Whose stream it's from. */
  broadcasterName: string;
  views: number;
  createdAt: Date;
}

/** Outcome of asking to push the next ad back. */
export interface AdSnoozeResult {
  /** False when no snoozes were left, in which case nothing changed. */
  snoozed: boolean;
  snoozesLeft: number;
  nextAdDate: Date | null;
}

/** A marker placed in the current broadcast. */
export interface StreamMarker {
  /** Seconds into the broadcast. */
  positionSeconds: number;
  description: string;
}

/** A recorded broadcast. */
export interface VodInfo {
  id: string;
  title: string;
  url: string;
  createdAt: Date;
}

/** How a queued redemption ends: completed, or canceled with the viewer's points refunded. */
export type RedemptionOutcome = 'fulfilled' | 'canceled';

// Capability objects. A façade that has one has that capability (see platforms/capabilities.ts),
// so a façade can't advertise a capability without implementing it.

/** PlatformCapability.ADS */
export interface AdsApi {
  /** Ad-break state for the current broadcast, or null if the stream is offline. */
  getNextAdBreak(): Promise<AdBreakInfo | null>;
  /** Push the next ad back, if a snooze is left. */
  snoozeNextAd(): Promise<AdSnoozeResult>;
}

/** PlatformCapability.SCHEDULE */
export interface ScheduleApi {
  /** Upcoming scheduled broadcasts, soonest first; empty if none. */
  getSchedule(): Promise<ScheduleSegment[]>;
}

/** PlatformCapability.CONTENT_LABELS */
export interface ContentLabelsApi {
  /** Content classification labels currently set on the channel. */
  getContentLabels(): Promise<string[]>;
  /** Replace the channel's content classification labels. */
  setContentLabels(labels: string[]): Promise<void>;
}

/** PlatformCapability.BROADCASTER_ABOUT */
export interface BroadcasterAboutApi {
  /** The broadcaster's channel bio/description, or null if unset. */
  getBroadcasterAbout(): Promise<string | null>;
}

/** PlatformCapability.SHOUTOUT */
export interface ShoutoutApi {
  /** Send the platform's native shoutout for another channel, by its login name. */
  shoutout(channelName: string): Promise<ShoutoutResult>;
}

/** PlatformCapability.CHANNEL_POINTS */
export interface ChannelPointsApi {
  /** Every channel point reward on the channel. */
  getChannelRewards(): Promise<ChannelReward[]>;
  /** Create an enabled reward. */
  createChannelReward(settings: ChannelRewardSettings): Promise<ChannelReward>;
  /** Update a reward this application created. */
  updateChannelReward(rewardId: string, changes: ChannelRewardChanges): Promise<void>;
  /** Complete or cancel a queued redemption, for a reward this application created. */
  resolveRedemption(
    rewardId: string,
    redemptionId: string,
    outcome: RedemptionOutcome
  ): Promise<void>;
}

/** PlatformCapability.MODERATION */
export interface ModerationApi {
  /** Time a user out of chat. */
  timeoutUser(userId: string, seconds: number, reason: string): Promise<void>;
  /** Delete one chat message. */
  deleteChatMessage(messageId: string): Promise<void>;
}

/** PlatformCapability.CLIPS */
export interface ClipsApi {
  /** Look up a clip by id; null if there's no such clip. */
  getClip(clipId: string): Promise<ClipInfo | null>;
}

/** PlatformCapability.FOLLOW_INFO */
export interface FollowInfoApi {
  /** When a user started following the channel, or null if they don't. */
  getFollowDate(userId: string): Promise<Date | null>;
}

/** PlatformCapability.ACCOUNT_AGE */
export interface AccountAgeApi {
  /** When a user's account was created, or null if there's no such user. */
  getAccountCreatedAt(userId: string): Promise<Date | null>;
}

/** PlatformCapability.MARKERS */
export interface MarkersApi {
  /** Mark the current point of the live broadcast. Throws while offline. */
  createStreamMarker(description?: string): Promise<StreamMarker>;
}

/** PlatformCapability.VODS */
export interface VodsApi {
  /**
   * Delete the most recent past broadcast (the current one while live) and return what was
   * deleted, or null if there was none.
   */
  deleteLatestVod(): Promise<VodInfo | null>;
}

/** PlatformCapability.ANNOUNCEMENTS */
export interface AnnouncementsApi {
  /** Post a highlighted announcement in chat, passed through `toSafeChatText()`. */
  sendAnnouncement(message: string): Promise<void>;
}

/** Every capability object a façade may have, by the property it has it under. */
export interface CapabilityApis {
  ads: AdsApi;
  schedule: ScheduleApi;
  contentLabels: ContentLabelsApi;
  broadcasterAbout: BroadcasterAboutApi;
  shoutout: ShoutoutApi;
  channelPoints: ChannelPointsApi;
  moderation: ModerationApi;
  clips: ClipsApi;
  followInfo: FollowInfoApi;
  accountAge: AccountAgeApi;
  markers: MarkersApi;
  vods: VodsApi;
  announcements: AnnouncementsApi;
}

export type CapabilityApiName = keyof CapabilityApis;

/**
 * The capabilities with no object of their own, which a façade declares outright: chat and
 * uptime are on every platform, and the three metadata writes are fields of `setStreamInfo()`.
 */
export type DeclaredCapability =
  | PlatformCapability.SEND_CHAT
  | PlatformCapability.SET_TITLE
  | PlatformCapability.SET_GAME
  | PlatformCapability.SET_TAGS
  | PlatformCapability.UPTIME;

/**
 * Platform-agnostic façade over one streaming platform. Implemented by TwitchPlatform and
 * YouTubePlatform, each delegating to that platform's integration trio.
 *
 * What only some platforms can do lives in optional capability objects (`CapabilityApis`); a
 * façade's capability set is its declared capabilities plus one per object it has
 * (`capabilitiesOf()`). Callers reach the objects through `StreamControlService.require()`.
 */
export interface IStreamPlatform extends Partial<Readonly<CapabilityApis>> {
  readonly platform: StreamingPlatform;

  /** The capabilities this platform has that no capability object stands for. */
  readonly declaredCapabilities: ReadonlySet<DeclaredCapability>;

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

  /**
   * Post a message to this platform's own chat. ChatRouter posts command replies with this.
   * Implementations must pass the message through `toSafeChatText()` (see chatMessage.ts) and
   * send it through `OwnChatMessages.record()`, so TuringMod ignores it when it comes back.
   */
  sendChatMessage(message: string): Promise<void>;

  /** Read current stream metadata. Throws if not connected. */
  getStreamInfo(): Promise<StreamInfo>;

  /** Apply metadata changes the platform supports; ignores fields it can't set. */
  setStreamInfo(info: Partial<StreamInfo>): Promise<void>;

  /** Milliseconds the current broadcast has been live, or null if offline. */
  getUptime(): Promise<number | null>;
}
