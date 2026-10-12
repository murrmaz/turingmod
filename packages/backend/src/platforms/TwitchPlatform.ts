import { IntegrationStatus, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import type { HelixCustomReward, HelixUpdateCustomRewardData } from '@twurple/api';
import { injectable, singleton } from 'tsyringe';
import { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import { unavailableReason } from './availability.js';
import { toSafeChatText } from './chatMessage.js';
import { NotAuthenticatedError } from './errors.js';
import type {
  AdBreakInfo,
  AdSnoozeResult,
  ChannelReward,
  ChannelRewardChanges,
  ChannelRewardSettings,
  ClipInfo,
  IStreamPlatform,
  RedemptionOutcome,
  ScheduleSegment,
  ShoutoutResult,
  StreamInfo,
  StreamMarker,
  VodInfo,
} from './interfaces/IStreamPlatform.js';
import { OwnChatMessages } from './OwnChatMessages.js';

/**
 * IStreamPlatform façade over the Twitch integration trio. Resolves the broadcaster id from
 * TwitchAuthIntegration and delegates reads/writes to TwitchApiIntegration's Helix methods.
 * Category search (name → id) stays Twitch-specific and lives here rather than in commands.
 */
@injectable()
@singleton()
export class TwitchPlatform implements IStreamPlatform {
  readonly platform = StreamingPlatform.TWITCH;

  constructor(
    private auth: TwitchAuthIntegration,
    private api: TwitchApiIntegration,
    private ownMessages: OwnChatMessages
  ) {}

  getCapabilities(): Set<PlatformCapability> {
    return new Set([
      PlatformCapability.SEND_CHAT,
      PlatformCapability.SET_TITLE,
      PlatformCapability.SET_GAME,
      PlatformCapability.SET_TAGS,
      PlatformCapability.UPTIME,
      PlatformCapability.ADS,
      PlatformCapability.SCHEDULE,
      PlatformCapability.CONTENT_LABELS,
      PlatformCapability.FOLLOW_INFO,
      PlatformCapability.ACCOUNT_AGE,
      PlatformCapability.BROADCASTER_ABOUT,
      PlatformCapability.SHOUTOUT,
      PlatformCapability.CHANNEL_POINTS,
      PlatformCapability.MODERATION,
      PlatformCapability.CLIPS,
      PlatformCapability.MARKERS,
      PlatformCapability.VODS,
      PlatformCapability.ANNOUNCEMENTS,
    ]);
  }

  getUnavailableReason(): string | null {
    const reason = unavailableReason(this.auth, this.platform);
    if (reason) {
      return reason;
    }
    // Connected but without a broadcaster id is not a state start() leaves behind; treat it
    // as unusable rather than letting a later call fail with a vaguer error.
    return this.auth.getAuthenticatedUserId() ? null : 'Twitch broadcaster id unavailable';
  }

  async isLive(): Promise<boolean> {
    // Defined to answer false rather than throw, so StreamControlService can skip an
    // unauthenticated platform while mirroring instead of recording it as a failure.
    const userId = this.authenticatedUserId();
    if (!userId) {
      return false;
    }
    const stream = await this.api.getStream(userId);
    return stream !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
    const userId = this.requireUserId();
    const text = toSafeChatText(message);
    await this.ownMessages.record(this.platform, async () => {
      const sent = await this.api.sendChatMessage(userId, text);
      return sent.isSent ? sent.id : null;
    });
  }

  async getStreamInfo(): Promise<StreamInfo> {
    const userId = this.requireUserId();
    const channel = await this.api.getChannel(userId);
    if (!channel) {
      throw new Error('Failed to retrieve channel information');
    }

    const info: StreamInfo = { title: channel.title };
    if (channel.gameName) {
      info.game = channel.gameName;
    }
    if (channel.tags && channel.tags.length > 0) {
      info.tags = channel.tags;
    }
    return info;
  }

  async setStreamInfo(info: Partial<StreamInfo>): Promise<void> {
    const userId = this.requireUserId();

    if (info.title !== undefined) {
      await this.api.setStreamTitle(userId, info.title);
    }

    if (info.game !== undefined) {
      const game = await this.api.searchGame(info.game);
      if (!game) {
        throw new Error(`Game not found: ${info.game}`);
      }
      await this.api.setStreamGame(userId, game.id);
    }

    if (info.tags !== undefined) {
      await this.api.setStreamTags(userId, info.tags);
    }
  }

  async getUptime(): Promise<number | null> {
    // Null rather than a throw: "not authenticated" and "offline" are the same answer here.
    const userId = this.authenticatedUserId();
    if (!userId) {
      return null;
    }
    const stream = await this.api.getStream(userId);
    if (!stream) {
      return null;
    }
    return Date.now() - stream.startDate.getTime();
  }

  async getNextAdBreak(): Promise<AdBreakInfo | null> {
    const userId = this.requireUserId();
    const stream = await this.api.getStream(userId);
    if (!stream) {
      return null;
    }
    const adSchedule = await this.api.getAdSchedule(userId);
    return { nextAdDate: adSchedule?.nextAdDate ?? null };
  }

  async getSchedule(): Promise<ScheduleSegment[]> {
    const userId = this.requireUserId();
    const schedule = await this.api.getSchedule(userId);
    const segments = schedule?.data?.segments ?? [];

    return segments.map((segment) => {
      const mapped: ScheduleSegment = { startDate: segment.startDate };
      if (segment.title) {
        mapped.title = segment.title;
      }
      if (segment.categoryName) {
        mapped.category = segment.categoryName;
      }
      return mapped;
    });
  }

  async getContentLabels(): Promise<string[]> {
    const userId = this.requireUserId();
    const channel = await this.api.getChannel(userId);
    if (!channel) {
      throw new Error('Failed to retrieve channel information');
    }
    return channel.contentClassificationLabels ?? [];
  }

  async setContentLabels(labels: string[]): Promise<void> {
    const userId = this.requireUserId();
    await this.api.setContentClassificationLabels(userId, labels);
  }

  async getBroadcasterAbout(): Promise<string | null> {
    const userId = this.requireUserId();
    const user = await this.api.getUserById(userId);
    const description = user?.description?.trim();
    return description ? description : null;
  }

  async shoutout(channelName: string): Promise<ShoutoutResult> {
    const userId = this.requireUserId();
    const target = await this.api.getUserByName(channelName);
    if (!target) {
      throw new Error(`Twitch user not found: ${channelName}`);
    }
    return await this.api.shoutoutUser(userId, target.id);
  }

  async getChannelRewards(): Promise<ChannelReward[]> {
    const userId = this.requireUserId();
    // Twitch answers "which rewards may this client edit" only as a filter on the list, so ask
    // for both and compare.
    const [all, manageable] = await Promise.all([
      this.api.getCustomRewards(userId, false),
      this.api.getCustomRewards(userId, true),
    ]);
    const manageableIds = new Set(manageable.map((reward) => reward.id));
    return all.map((reward) => toChannelReward(reward, manageableIds.has(reward.id)));
  }

  async createChannelReward(settings: ChannelRewardSettings): Promise<ChannelReward> {
    const userId = this.requireUserId();
    const created = await this.api.createCustomReward(userId, {
      title: settings.title,
      cost: settings.cost,
      prompt: settings.prompt,
      isEnabled: true,
      userInputRequired: settings.userInputRequired,
      globalCooldown: settings.globalCooldownSeconds,
      maxRedemptionsPerStream: settings.maxPerStream,
      maxRedemptionsPerUserPerStream: settings.maxPerUserPerStream,
      autoFulfill: settings.autoFulfill,
    });
    return toChannelReward(created, true);
  }

  async updateChannelReward(rewardId: string, changes: ChannelRewardChanges): Promise<void> {
    const userId = this.requireUserId();
    await this.api.updateCustomReward(userId, rewardId, toHelixRewardUpdate(changes));
  }

  async resolveRedemption(
    rewardId: string,
    redemptionId: string,
    outcome: RedemptionOutcome
  ): Promise<void> {
    const userId = this.requireUserId();
    await this.api.updateRedemptionStatus(
      userId,
      rewardId,
      [redemptionId],
      outcome === 'fulfilled' ? 'FULFILLED' : 'CANCELED'
    );
  }

  async timeoutUser(userId: string, seconds: number, reason: string): Promise<void> {
    const broadcasterId = this.requireUserId();
    await this.api.timeoutUser(broadcasterId, userId, seconds, reason);
  }

  async deleteChatMessage(messageId: string): Promise<void> {
    const broadcasterId = this.requireUserId();
    await this.api.deleteChatMessage(broadcasterId, messageId);
  }

  async getClip(clipId: string): Promise<ClipInfo | null> {
    this.requireUserId();
    const clip = await this.api.getClipById(clipId);
    if (!clip) {
      return null;
    }
    return {
      id: clip.id,
      url: clip.url,
      title: clip.title,
      creatorName: clip.creatorDisplayName,
      broadcasterName: clip.broadcasterDisplayName,
      views: clip.views,
      createdAt: clip.creationDate,
    };
  }

  async snoozeNextAd(): Promise<AdSnoozeResult> {
    const userId = this.requireUserId();
    // Twitch rejects a snooze with none left; check first so that's an answer, not an error.
    const schedule = await this.api.getAdSchedule(userId);
    if (!schedule || schedule.snoozeCount <= 0) {
      return {
        snoozed: false,
        snoozesLeft: schedule?.snoozeCount ?? 0,
        nextAdDate: schedule?.nextAdDate ?? null,
      };
    }
    const result = await this.api.snoozeNextAd(userId);
    return { snoozed: true, snoozesLeft: result.snoozeCount, nextAdDate: result.nextAdDate };
  }

  async getFollowDate(userId: string): Promise<Date | null> {
    const broadcasterId = this.requireUserId();
    const { data } = await this.api.getChannelFollowers(broadcasterId, userId);
    return data[0]?.followDate ?? null;
  }

  async getAccountCreatedAt(userId: string): Promise<Date | null> {
    this.requireUserId();
    const user = await this.api.getUserById(userId);
    return user?.creationDate ?? null;
  }

  async createStreamMarker(description?: string): Promise<StreamMarker> {
    const userId = this.requireUserId();
    // Twitch only places markers in a live broadcast; say so rather than surface its error.
    if (!(await this.api.getStream(userId))) {
      throw new Error('Stream markers can only be created while live');
    }
    const marker = await this.api.createStreamMarker(userId, description);
    return { positionSeconds: marker.positionInSeconds, description: marker.description };
  }

  async deleteLatestVod(): Promise<VodInfo | null> {
    const userId = this.requireUserId();
    const { data } = await this.api.getVideosByUser(userId, { type: 'archive', limit: 1 });
    const video = data[0];
    if (!video) {
      return null;
    }
    await this.api.deleteVideos(userId, [video.id]);
    return { id: video.id, title: video.title, url: video.url, createdAt: video.creationDate };
  }

  async sendAnnouncement(message: string): Promise<void> {
    const userId = this.requireUserId();
    await this.api.sendAnnouncement(userId, toSafeChatText(message));
  }

  /**
   * The broadcaster id, but only while auth is actually usable. Keyed on the integration's
   * status rather than the id alone: the id outlives a stop(), so a non-null id on its own
   * doesn't prove the API client behind it still exists.
   */
  private authenticatedUserId(): string | null {
    if (this.auth.getStatus() !== IntegrationStatus.CONNECTED) {
      return null;
    }
    return this.auth.getAuthenticatedUserId();
  }

  /**
   * Resolve the broadcaster id or explain why Twitch is unusable. Token expiry never lands
   * here — the RefreshingAuthProvider renews in the background and only downgrades the
   * integration's status once a refresh has definitively failed.
   */
  private requireUserId(): string {
    const userId = this.authenticatedUserId();
    if (userId) {
      return userId;
    }

    throw new NotAuthenticatedError(
      StreamingPlatform.TWITCH,
      this.auth.getStatus() === IntegrationStatus.NEEDS_REAUTH,
      this.getUnavailableReason() ?? 'Not connected to Twitch'
    );
  }
}

function toChannelReward(reward: HelixCustomReward, manageable: boolean): ChannelReward {
  return {
    id: reward.id,
    title: reward.title,
    cost: reward.cost,
    prompt: reward.prompt,
    userInputRequired: reward.userInputRequired,
    globalCooldownSeconds: reward.globalCooldown,
    maxPerStream: reward.maxRedemptionsPerStream,
    maxPerUserPerStream: reward.maxRedemptionsPerUserPerStream,
    autoFulfill: reward.autoFulfill,
    isEnabled: reward.isEnabled,
    isPaused: reward.isPaused,
    manageable,
  };
}

/** Only the fields being changed: an absent field leaves Twitch's value alone. */
function toHelixRewardUpdate(changes: ChannelRewardChanges): HelixUpdateCustomRewardData {
  const data: HelixUpdateCustomRewardData = {};
  if (changes.title !== undefined) data.title = changes.title;
  if (changes.cost !== undefined) data.cost = changes.cost;
  if (changes.prompt !== undefined) data.prompt = changes.prompt;
  if (changes.userInputRequired !== undefined) data.userInputRequired = changes.userInputRequired;
  if (changes.globalCooldownSeconds !== undefined) {
    data.globalCooldown = changes.globalCooldownSeconds;
  }
  if (changes.maxPerStream !== undefined) data.maxRedemptionsPerStream = changes.maxPerStream;
  if (changes.maxPerUserPerStream !== undefined) {
    data.maxRedemptionsPerUserPerStream = changes.maxPerUserPerStream;
  }
  if (changes.autoFulfill !== undefined) data.autoFulfill = changes.autoFulfill;
  if (changes.isPaused !== undefined) data.isPaused = changes.isPaused;
  return data;
}
