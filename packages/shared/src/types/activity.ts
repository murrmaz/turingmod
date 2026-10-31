import { z } from 'zod';

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

/**
 * The EventBus events the activity log records, by name, and each one's category. The backend
 * forwards exactly these (each must be an EventMap event) and the console describes each one, so
 * an event added here is a compile error on both sides until it is handled.
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
} as const satisfies Record<string, ActivityCategory>;

export type ActivityEventName = keyof typeof ACTIVITY_EVENT_CATEGORIES;

/**
 * The table's keys, typed: Object.keys only knows it returns strings. A non-empty tuple, which
 * is what `z.enum` takes.
 */
export const ACTIVITY_EVENT_NAMES = Object.keys(ACTIVITY_EVENT_CATEGORIES) as [
  ActivityEventName,
  ...ActivityEventName[],
];

/**
 * One row of the activity feed. Same shape whether it came from a live broadcast or the DB.
 */
export const ActivityLogEntrySchema = z.strictObject({
  /** Unique identifier */
  id: z.string().min(1),

  /**
   * Fully-qualified source event name, e.g. 'twitch.follow', which also gives the entry's category.
   * A stored entry under an event the log no longer records fails the read.
   */
  event: z.enum(ACTIVITY_EVENT_NAMES),

  /** Category-specific payload (already serialized-safe: no Error objects, no functions) */
  data: z.record(z.string(), z.unknown()),

  /** Timestamp when the activity occurred */
  timestamp: z.number(),
});

export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;
