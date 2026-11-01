import { z } from 'zod';
import { PermissionLevel } from '../constants/permissions.js';
import { StreamingPlatform } from '../constants/platform.js';
import { IntegrationStatus } from './integration.js';

/**
 * An activity log entry's category, which follows from its event (ACTIVITY_EVENT_CATEGORIES)
 */
export enum ActivityCategory {
  CHAT = 'chat',
  COMMAND = 'command',
  EVENT = 'event',
  STATUS = 'status',
  ERROR = 'error',
}

const Platform = z.enum(StreamingPlatform);
/** A time an event reports, as a Date reads once it has been through JSON. */
const Instant = z.iso.datetime();

const CommandRun = z.object({
  command: z.string(),
  username: z.string(),
  userId: z.string(),
  platform: Platform,
  args: z.array(z.string()),
  /** The reply for chat. */
  message: z.string(),
  isSimulation: z.boolean(),
});
const StreamBreak = z.object({
  reason: z.enum(['ad', 'manual']),
  durationSeconds: z.number(),
});

/** One event's row of the feed: which event, and the payload it carries. */
function entryOf<E extends string, D extends z.ZodType>(event: E, data: D) {
  return z.strictObject({
    id: z.string().min(1),
    /** Fully-qualified source event name, which also gives the entry's category. */
    event: z.literal(event),
    data,
    /** When the activity occurred. */
    timestamp: z.number(),
  });
}

/**
 * One row of the activity feed. Same shape whether it came from a live broadcast or the DB, and
 * what each event's payload holds is what the backend sends, after JSON: no Dates or Errors.
 *
 * Unlike other data TuringMod owns, payloads ignore keys they don't know, and a stored row that
 * still doesn't fit is left out of a read (ActivityLogRepository). The log is capped, so a row
 * written under an older payload ages out by itself, and a change here needs no migration.
 */
export const ActivityLogEntrySchema = z.discriminatedUnion('event', [
  entryOf(
    'chat.message',
    z.object({
      platform: Platform,
      platformUserId: z.string(),
      username: z.string(),
      message: z.string(),
      permissionLevel: z.enum(PermissionLevel),
      badges: z.array(z.string()),
      timestamp: z.number(),
      messageId: z.string(),
      channelId: z.string(),
      channelName: z.string().exactOptional(),
    })
  ),
  entryOf(
    'command.executed',
    z.discriminatedUnion('success', [
      CommandRun.extend({ success: z.literal(true) }),
      CommandRun.extend({
        success: z.literal(false),
        errorCode: z.string(),
        /** Why it failed, for the streamer; never shown in chat. */
        reason: z.string(),
      }),
    ])
  ),
  entryOf(
    'twitch.follow',
    z.object({
      userId: z.string(),
      userName: z.string(),
      userDisplayName: z.string(),
      followDate: Instant,
    })
  ),
  entryOf(
    'twitch.subscribe',
    z.object({
      userId: z.string(),
      userName: z.string(),
      userDisplayName: z.string(),
      tier: z.string(),
      isGift: z.boolean(),
    })
  ),
  entryOf(
    'twitch.raid',
    z.object({
      fromBroadcasterId: z.string(),
      fromBroadcasterName: z.string(),
      fromBroadcasterDisplayName: z.string(),
      viewers: z.number(),
    })
  ),
  entryOf(
    'twitch.cheer',
    z.object({
      // All null for an anonymous cheer.
      userId: z.string().nullable(),
      userName: z.string().nullable(),
      userDisplayName: z.string().nullable(),
      bits: z.number(),
      message: z.string(),
    })
  ),
  entryOf(
    'twitch.ad.break',
    z.object({
      durationSeconds: z.number(),
      startedAt: Instant,
      isAutomatic: z.boolean(),
      broadcasterId: z.string(),
      broadcasterName: z.string(),
      broadcasterDisplayName: z.string(),
    })
  ),
  entryOf('stream.break.started', StreamBreak),
  entryOf('stream.break.ended', StreamBreak),
  entryOf(
    'twitch.channelPoint.redemption',
    z.object({
      id: z.string(),
      rewardId: z.string(),
      rewardTitle: z.string(),
      rewardCost: z.number(),
      userId: z.string(),
      userName: z.string(),
      userDisplayName: z.string(),
      input: z.string(),
      status: z.string(),
      redeemedAt: Instant,
    })
  ),
  entryOf('obs.scene.changed', z.object({ sceneName: z.string() })),
  entryOf(
    'obs.stream.stateChanged',
    z.object({ outputActive: z.boolean(), outputState: z.string() })
  ),
  entryOf(
    'obs.record.stateChanged',
    z.object({
      outputActive: z.boolean(),
      outputState: z.string(),
      // Only set once a recording has stopped, whatever obs-websocket-js's types say.
      outputPath: z.string().nullable(),
    })
  ),
  entryOf(
    'obs.sceneItem.stateChanged',
    z.object({ sceneName: z.string(), sceneItemId: z.number(), sceneItemEnabled: z.boolean() })
  ),
  // A device can send any fields it likes beside its type (see the Arduino protocol).
  entryOf('arduino.message', z.looseObject({ type: z.string().min(1) })),
  entryOf('integration.status', z.object({ name: z.string(), status: z.enum(IntegrationStatus) })),
  entryOf(
    'platform.availability',
    z.object({ platform: Platform, available: z.boolean(), reason: z.string().nullable() })
  ),
  entryOf(
    'platform.liveState',
    z.object({ platform: Platform, live: z.boolean(), startedAt: z.number().nullable() })
  ),
  entryOf('integration.error', z.object({ name: z.string(), message: z.string() })),
]);

export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export type ActivityEventName = ActivityLogEntry['event'];

/** The payload of one event's entries. */
export type ActivityData<E extends ActivityEventName> = Extract<
  ActivityLogEntry,
  { event: E }
>['data'];

/**
 * The EventBus events the activity log records, by name, and each one's category. The backend
 * forwards exactly these (each must be an EventMap event) and the console describes each one, so
 * an event added here or to ActivityLogEntrySchema is a compile error on both sides until it is
 * handled, and until the two agree.
 */
export const ACTIVITY_EVENT_CATEGORIES = {
  'chat.message': ActivityCategory.CHAT,
  'command.executed': ActivityCategory.COMMAND,
  'twitch.follow': ActivityCategory.EVENT,
  'twitch.subscribe': ActivityCategory.EVENT,
  'twitch.raid': ActivityCategory.EVENT,
  'twitch.cheer': ActivityCategory.EVENT,
  'twitch.ad.break': ActivityCategory.EVENT,
  'stream.break.started': ActivityCategory.EVENT,
  'stream.break.ended': ActivityCategory.EVENT,
  'twitch.channelPoint.redemption': ActivityCategory.EVENT,
  'obs.scene.changed': ActivityCategory.EVENT,
  'obs.stream.stateChanged': ActivityCategory.EVENT,
  'obs.record.stateChanged': ActivityCategory.EVENT,
  'obs.sceneItem.stateChanged': ActivityCategory.EVENT,
  'arduino.message': ActivityCategory.EVENT,
  'integration.status': ActivityCategory.STATUS,
  'platform.availability': ActivityCategory.STATUS,
  'platform.liveState': ActivityCategory.EVENT,
  'integration.error': ActivityCategory.ERROR,
} as const satisfies Record<ActivityEventName, ActivityCategory>;

/**
 * The table's keys, typed: Object.keys only knows it returns strings. A non-empty tuple, which
 * is what `z.enum` takes.
 */
export const ACTIVITY_EVENT_NAMES = Object.keys(ACTIVITY_EVENT_CATEGORIES) as [
  ActivityEventName,
  ...ActivityEventName[],
];
