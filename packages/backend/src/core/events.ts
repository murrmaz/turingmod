import type {
  CommandErrorCode,
  ExecutorErrorCode,
  IntegrationStatus,
  PlatformLiveState,
  StreamingPlatform,
  YouTubeChatState,
} from '@turingmod/shared';
import type { OBSEventTypes } from 'obs-websocket-js';
import type { ChatMessageEvent } from '../chat/chatMessage.js';
import type { DeviceMessage } from '../integrations/implementations/arduino/arduinoProtocol.js';

/**
 * Every EventBus event, by name, with the payload it carries. `EventBus` is typed against this
 * map, so an emitter and its subscribers can't disagree about a name or a field: a rename here is
 * a compile error everywhere it matters.
 *
 * Names are dot-separated, lowercase-first camelCase segments, most general first:
 * `<source>.<subject>[.<detail>]`, e.g. `twitch.channelPoint.redemption`.
 *
 * Payload types live here rather than beside whichever class happens to emit or consume them, so
 * there is one declaration per event.
 */
export interface EventMap {
  /** Raw incoming chat, before `OwnChatMessages` drops TuringMod's own messages. */
  'chat.received': ChatMessageEvent;
  /** Incoming chat minus TuringMod's own messages; what every chat consumer listens to. */
  'chat.message': ChatMessageEvent;
  'command.executed': CommandExecutedEvent;

  'integration.status': IntegrationStatusEvent;
  'integration.error': IntegrationErrorEvent;
  /** An authorization finished, either way (see OAuthFlowService.handleCallback). */
  'oauth.completed': OAuthCompletedEvent;

  /** A platform became usable or stopped being usable (see PlatformAvailability). */
  'platform.availability': PlatformAvailabilityEvent;
  /** A platform started or stopped broadcasting (see PlatformLiveStatus). */
  'platform.liveState': PlatformLiveStateEvent;

  'stream.break.started': StreamBreakEvent;
  'stream.break.ended': StreamBreakEvent;
  /** The streaming software started or stopped sending the stream out (see ObsStreamState). */
  'stream.output.changed': StreamOutputEvent;
  /**
   * A platform's title, game or tags changed: a mirrored write (StreamControlService) or, for
   * Twitch, any change at all (EventSub channel.update). It may be published twice for one change.
   */
  'stream.info.changed': StreamInfoChangedEvent;

  'twitch.follow': TwitchFollowEvent;
  'twitch.subscribe': TwitchSubscribeEvent;
  'twitch.raid': TwitchRaidEvent;
  'twitch.cheer': TwitchCheerEvent;
  'twitch.stream.online': TwitchStreamOnlineEvent;
  'twitch.stream.offline': TwitchStreamOfflineEvent;
  'twitch.ad.break': TwitchAdBreakEvent;
  'twitch.channelPoint.redemption': RewardRedemption;
  /** Twitch rejected our grant; `TwitchAuthIntegration` moves to NEEDS_REAUTH. */
  'twitch.authorizationRevoked': TwitchAuthorizationRevokedEvent;

  'youtube.chat.state': YouTubeChatStateEvent;

  'obs.scene.changed': OBSEventTypes['CurrentProgramSceneChanged'];
  'obs.stream.stateChanged': OBSEventTypes['StreamStateChanged'];
  'obs.record.stateChanged': OBSEventTypes['RecordStateChanged'];
  'obs.sceneItem.stateChanged': OBSEventTypes['SceneItemEnableStateChanged'];

  /** Anything a connected Arduino sent after its `hello` (see ArduinoIntegration). */
  'arduino.message': DeviceMessage;
}

export type EventName = keyof EventMap;

/** A command run, successful or not (see CommandExecutor). */
export interface CommandExecutedEvent {
  command: string;
  username: string;
  userId: string;
  platform: StreamingPlatform;
  args: string[];
  success: boolean;
  message: string;
  errorCode: CommandErrorCode | ExecutorErrorCode | undefined;
  /** Why it failed, when it did: for the activity log, never shown in chat. */
  reason: string | undefined;
  isSimulation: boolean;
}

/** Published for every integration status change (see IntegrationManager.register). */
export interface IntegrationStatusEvent {
  name: string;
  status: IntegrationStatus;
}

/** A failure an integration reported without changing its status (see IntegrationEvents). */
export interface IntegrationErrorEvent {
  name: string;
  error: Error;
}

/** An OAuth redirect reached the HTTP server; `clientId` is the console client that started it. */
export interface OAuthCompletedEvent {
  integrationName: string;
  success: boolean;
  errorMessage?: string;
}

export interface PlatformAvailabilityEvent {
  platform: StreamingPlatform;
  available: boolean;
  /** Why it can't be acted on, when it can't; the façade's `getUnavailableReason()`. */
  reason: string | null;
}

/**
 * Why `PlatformLiveStatus` changed its view of a platform: the platform said so (`reported`), or
 * the platform stopped being usable (`unavailable`), which makes it unknown rather than offline;
 * the console shows it as not live either way.
 */
export interface PlatformLiveStateEvent extends PlatformLiveState {
  cause: 'reported' | 'unavailable';
}

/** What started a break. Ad breaks come from Twitch; manual ones from `!break`. */
export type BreakReason = 'ad' | 'manual';

export interface StreamBreakEvent {
  reason: BreakReason;
  /** Planned length at start; actual length at end. */
  durationSeconds: number;
}

export interface TwitchFollowEvent {
  userId: string;
  userName: string;
  userDisplayName: string;
  followDate: Date;
}

export interface TwitchSubscribeEvent {
  userId: string;
  userName: string;
  userDisplayName: string;
  tier: string;
  isGift: boolean;
}

export interface TwitchRaidEvent {
  fromBroadcasterId: string;
  /** The raiding channel's login name. */
  fromBroadcasterName: string;
  fromBroadcasterDisplayName: string;
  viewers: number;
}

export interface TwitchCheerEvent {
  userId: string | null;
  userName: string | null;
  userDisplayName: string | null;
  bits: number;
  message: string;
}

export interface TwitchStreamOnlineEvent {
  broadcasterId: string;
  broadcasterName: string;
  broadcasterDisplayName: string;
  startedAt: Date;
}

export interface TwitchStreamOfflineEvent {
  broadcasterId: string;
  broadcasterName: string;
  broadcasterDisplayName: string;
}

export interface TwitchAdBreakEvent {
  durationSeconds: number;
  startedAt: Date;
  isAutomatic: boolean;
  broadcasterId: string;
  broadcasterName: string;
  broadcasterDisplayName: string;
}

/** A channel point redemption, routed to its handler by `RewardRouter`. */
export interface RewardRedemption {
  /** The redemption's own id — not the reward's. */
  id: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  userId: string;
  userName: string;
  userDisplayName: string;
  /** What the viewer typed, for rewards that prompt for text; empty otherwise. */
  input: string;
  /** `unfulfilled` while the reward waits in the request queue, `fulfilled` if it skips it. */
  status: string;
  redeemedAt: Date;
}

export interface TwitchAuthorizationRevokedEvent {
  /** The EventSub revocation status, or `api-call-unauthorized` for a 401 from Helix. */
  reason: string;
}

export interface StreamInfoChangedEvent {
  platforms: StreamingPlatform[];
}

export interface StreamOutputEvent {
  /**
   * True when the stream started going out. That says nothing about which platforms receive it,
   * so a platform treats it as a reason to look for its own broadcast, not as proof of one.
   */
  streaming: boolean;
}

export interface YouTubeChatStateEvent {
  state: YouTubeChatState;
}
