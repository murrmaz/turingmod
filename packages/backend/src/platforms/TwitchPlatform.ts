import { IntegrationStatus, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import type {
  HelixChannelUpdate,
  HelixCustomReward,
  HelixUpdateCustomRewardData,
} from '@twurple/api';
import { singleton } from 'tsyringe';
import { toSafeChatText } from '../chat/chatMessage.js';
import { OwnChatMessages } from '../chat/OwnChatMessages.js';
import { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import { unavailableReason } from './availability.js';
import { InvalidStreamInfoError, NotAuthenticatedError } from './errors.js';
import type {
  AccountAgeApi,
  AdsApi,
  AnnouncementsApi,
  BroadcasterAboutApi,
  ChannelPage,
  ChannelPointsApi,
  ChannelReward,
  ChannelRewardChanges,
  ClipsApi,
  ContentLabelsApi,
  DeclaredCapability,
  FollowInfoApi,
  IStreamPlatform,
  MarkersApi,
  ModerationApi,
  ScheduleApi,
  ScheduleSegment,
  ShoutoutApi,
  StreamInfo,
  VodsApi,
} from './interfaces/IStreamPlatform.js';
import { TwitchShoutoutCooldowns } from './TwitchShoutoutCooldowns.js';

/**
 * The content classification labels a channel may set itself. Twitch applies MatureGame from
 * the category, so it can be read back but not set.
 */
const TWITCH_CONTENT_LABELS = [
  'DebatedSocialIssuesAndPolitics',
  'DrugsIntoxication',
  'SexualThemes',
  'ViolentGraphic',
  'Gambling',
  'ProfanityVulgarity',
] as const;

/** A label as typed in chat, in any case, as Twitch's id for it. */
function toContentLabelId(name: string): string {
  const id = TWITCH_CONTENT_LABELS.find((label) => label.toLowerCase() === name.toLowerCase());
  if (!id) {
    throw new InvalidStreamInfoError(
      `Unknown content label: ${name}. Labels: ${TWITCH_CONTENT_LABELS.join(', ')}`
    );
  }
  return id;
}

/**
 * IStreamPlatform façade over the Twitch integration trio: everything TuringMod does on Twitch.
 *
 * Owns the Twitch endpoints it calls and the Twitch rules around them (category name → id,
 * checking for a snooze before snoozing, live-only markers, shoutout cooldowns), and translates
 * Twurple's types into the platform-agnostic ones commands see. Connection health is not its
 * concern: it makes every call through TwitchApiIntegration.request(), which supplies a client
 * built on the current grant and reports a revoked one, and takes the broadcaster id from
 * TwitchAuthIntegration.
 *
 * Has every capability object; each method resolves the broadcaster id itself, so an object is
 * safe to hold while Twitch is disconnected and fails with NotAuthenticatedError when used.
 */
@singleton()
export class TwitchPlatform implements IStreamPlatform {
  readonly platform = StreamingPlatform.TWITCH;
  readonly declaredCapabilities = new Set<DeclaredCapability>([
    PlatformCapability.SEND_CHAT,
    PlatformCapability.SET_TITLE,
    PlatformCapability.SET_GAME,
    PlatformCapability.SET_TAGS,
    PlatformCapability.UPTIME,
  ]);

  /** Twitch's own shoutout limits, checked here so a refusal is an answer rather than an error. */
  private readonly shoutoutCooldowns = new TwitchShoutoutCooldowns();

  constructor(
    private auth: TwitchAuthIntegration,
    private api: TwitchApiIntegration,
    private ownMessages: OwnChatMessages
  ) {}

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
    const stream = await this.liveStream(userId);
    return stream !== null;
  }

  async sendChatMessage(message: string): Promise<void> {
    const userId = this.requireUserId();
    const text = toSafeChatText(message);
    await this.ownMessages.record(this.platform, async () => {
      const sent = await this.api.request((c) => c.chat.sendChatMessage(userId, text));
      return sent.isSent ? sent.id : null;
    });
  }

  async getStreamInfo(): Promise<StreamInfo> {
    const userId = this.requireUserId();
    const channel = await this.api.request((c) => c.channels.getChannelInfoById(userId));
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

    const update: HelixChannelUpdate = {};
    if (info.title !== undefined) {
      update.title = info.title;
    }
    if (info.game !== undefined) {
      // Twitch takes a category id; resolve the name first, so an unknown game changes nothing.
      const gameName = info.game;
      const game = await this.api.request((c) => c.games.getGameByName(gameName));
      if (!game) {
        throw new InvalidStreamInfoError(`Game not found: ${gameName}`);
      }
      update.gameId = game.id;
    }
    if (info.tags !== undefined) {
      update.tags = info.tags;
    }
    if (Object.keys(update).length > 0) {
      await this.api.request((c) => c.channels.updateChannelInfo(userId, update));
    }
  }

  async getUptime(): Promise<number | null> {
    // Null rather than a throw: "not authenticated" and "offline" are the same answer here.
    const userId = this.authenticatedUserId();
    if (!userId) {
      return null;
    }
    const stream = await this.liveStream(userId);
    if (!stream) {
      return null;
    }
    return Date.now() - stream.startDate.getTime();
  }

  async getChannelPage(): Promise<ChannelPage> {
    const userId = this.requireUserId();
    const user = await this.api.request((c) => c.users.getUserById(userId));
    if (!user) {
      throw new Error('Failed to retrieve the broadcaster');
    }
    return {
      displayName: user.displayName,
      url: `https://www.twitch.tv/${user.name}`,
      // Served for the channel rather than a stream, so it needs no lookup and exists as soon as
      // Twitch has a frame; until then it's Twitch's offline placeholder.
      previewImageUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${user.name}-1280x720.jpg`,
    };
  }

  readonly ads: AdsApi = {
    getNextAdBreak: async () => {
      const userId = this.requireUserId();
      const stream = await this.liveStream(userId);
      if (!stream) {
        return null;
      }
      const adSchedule = await this.api.request((c) => c.channels.getAdSchedule(userId));
      return { nextAdDate: adSchedule?.nextAdDate ?? null };
    },

    snoozeNextAd: async () => {
      const userId = this.requireUserId();
      // Twitch rejects a snooze with none left; check first so that's an answer, not an error.
      const schedule = await this.api.request((c) => c.channels.getAdSchedule(userId));
      if (!schedule || schedule.snoozeCount <= 0) {
        return {
          snoozed: false,
          snoozesLeft: schedule?.snoozeCount ?? 0,
          nextAdDate: schedule?.nextAdDate ?? null,
        };
      }
      const result = await this.api.request((c) => c.channels.snoozeNextAd(userId));
      return { snoozed: true, snoozesLeft: result.snoozeCount, nextAdDate: result.nextAdDate };
    },
  };

  readonly schedule: ScheduleApi = {
    getSchedule: async () => {
      const userId = this.requireUserId();
      const schedule = await this.api.request((c) => c.schedule.getSchedule(userId));
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
    },
  };

  readonly contentLabels: ContentLabelsApi = {
    getContentLabels: async () => {
      const userId = this.requireUserId();
      const channel = await this.api.request((c) => c.channels.getChannelInfoById(userId));
      if (!channel) {
        throw new Error('Failed to retrieve channel information');
      }
      return channel.contentClassificationLabels ?? [];
    },

    setContentLabels: async (labels) => {
      const wanted = new Set(labels.map(toContentLabelId));
      const userId = this.requireUserId();
      // Twurple types this field as names, but Helix takes every label with an on/off flag and
      // leaves the ones it isn't sent alone, so send them all to replace the set.
      await this.api.request((c) =>
        c.callApi({
          type: 'helix',
          url: 'channels',
          method: 'PATCH',
          userId,
          scopes: ['channel:manage:broadcast'],
          query: { broadcaster_id: userId },
          jsonBody: {
            content_classification_labels: TWITCH_CONTENT_LABELS.map((id) => ({
              id,
              is_enabled: wanted.has(id),
            })),
          },
        })
      );
    },
  };

  readonly broadcasterAbout: BroadcasterAboutApi = {
    getBroadcasterAbout: async () => {
      const userId = this.requireUserId();
      const user = await this.api.request((c) => c.users.getUserById(userId));
      const description = user?.description?.trim();
      return description ? description : null;
    },
  };

  readonly shoutout: ShoutoutApi = {
    shoutout: async (channelName) => {
      const userId = this.requireUserId();
      const target = await this.api.request((c) => c.users.getUserByName(channelName));
      if (!target) {
        throw new Error(`Twitch user not found: ${channelName}`);
      }
      const refused = this.shoutoutCooldowns.check(target.id);
      if (refused) {
        return refused;
      }
      await this.api.request((c) => c.chat.shoutoutUser(userId, target.id));
      this.shoutoutCooldowns.record(target.id);
      return { sent: true };
    },
  };

  readonly channelPoints: ChannelPointsApi = {
    getChannelRewards: async () => {
      const userId = this.requireUserId();
      // Twitch answers "which rewards may this client edit" only as a filter on the list, so
      // ask for both and compare.
      const [all, manageable] = await Promise.all([
        this.api.request((c) => c.channelPoints.getCustomRewards(userId, false)),
        this.api.request((c) => c.channelPoints.getCustomRewards(userId, true)),
      ]);
      const manageableIds = new Set(manageable.map((reward) => reward.id));
      return all.map((reward) => toChannelReward(reward, manageableIds.has(reward.id)));
    },

    createChannelReward: async (settings) => {
      const userId = this.requireUserId();
      const created = await this.api.request((c) =>
        c.channelPoints.createCustomReward(userId, {
          title: settings.title,
          cost: settings.cost,
          prompt: settings.prompt,
          isEnabled: true,
          userInputRequired: settings.userInputRequired,
          globalCooldown: settings.globalCooldownSeconds,
          maxRedemptionsPerStream: settings.maxPerStream,
          maxRedemptionsPerUserPerStream: settings.maxPerUserPerStream,
          autoFulfill: settings.autoFulfill,
        })
      );
      return toChannelReward(created, true);
    },

    updateChannelReward: async (rewardId, changes) => {
      const userId = this.requireUserId();
      await this.api.request((c) =>
        c.channelPoints.updateCustomReward(userId, rewardId, toHelixRewardUpdate(changes))
      );
    },

    resolveRedemption: async (rewardId, redemptionId, outcome) => {
      const userId = this.requireUserId();
      const status = outcome === 'fulfilled' ? 'FULFILLED' : 'CANCELED';
      await this.api.request((c) =>
        c.channelPoints.updateRedemptionStatusByIds(userId, rewardId, [redemptionId], status)
      );
    },
  };

  readonly moderation: ModerationApi = {
    timeoutUser: async (userId, seconds, reason) => {
      const broadcasterId = this.requireUserId();
      await this.api.request((c) =>
        c.moderation.banUser(broadcasterId, { user: userId, duration: seconds, reason })
      );
    },

    deleteChatMessage: async (messageId) => {
      const broadcasterId = this.requireUserId();
      await this.api.request((c) => c.moderation.deleteChatMessages(broadcasterId, messageId));
    },
  };

  readonly clips: ClipsApi = {
    getClip: async (clipId) => {
      this.requireUserId();
      const clip = await this.api.request((c) => c.clips.getClipById(clipId));
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
    },
  };

  readonly followInfo: FollowInfoApi = {
    getFollowDate: async (userId) => {
      const broadcasterId = this.requireUserId();
      const { data } = await this.api.request((c) =>
        c.channels.getChannelFollowers(broadcasterId, userId)
      );
      return data[0]?.followDate ?? null;
    },
  };

  readonly accountAge: AccountAgeApi = {
    getAccountCreatedAt: async (userId) => {
      this.requireUserId();
      const user = await this.api.request((c) => c.users.getUserById(userId));
      return user?.creationDate ?? null;
    },
  };

  readonly markers: MarkersApi = {
    createStreamMarker: async (description) => {
      const userId = this.requireUserId();
      // Twitch only places markers in a live broadcast; say so rather than surface its error.
      if (!(await this.liveStream(userId))) {
        throw new Error('Stream markers can only be created while live');
      }
      const marker = await this.api.request((c) =>
        c.streams.createStreamMarker(userId, description)
      );
      return { positionSeconds: marker.positionInSeconds, description: marker.description };
    },
  };

  readonly vods: VodsApi = {
    deleteLatestVod: async () => {
      const userId = this.requireUserId();
      const { data } = await this.api.request((c) =>
        c.videos.getVideosByUser(userId, { type: 'archive', limit: 1 })
      );
      const video = data[0];
      if (!video) {
        return null;
      }
      await this.api.request((c) => c.videos.deleteVideosByIds(userId, [video.id]));
      return { id: video.id, title: video.title, url: video.url, createdAt: video.creationDate };
    },
  };

  readonly announcements: AnnouncementsApi = {
    sendAnnouncement: async (message) => {
      const userId = this.requireUserId();
      const text = toSafeChatText(message);
      await this.api.request((c) => c.chat.sendAnnouncement(userId, { message: text }));
    },
  };

  /** The broadcaster's current stream, or null when offline. */
  private liveStream(userId: string) {
    return this.api.request((c) => c.streams.getStreamByUserId(userId));
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
