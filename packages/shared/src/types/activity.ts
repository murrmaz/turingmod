import { z } from 'zod';

/**
 * Category of an activity log entry
 */
export enum ActivityCategory {
  CHAT = 'chat',
  COMMAND = 'command',
  EVENT = 'event',
  STATUS = 'status',
  ERROR = 'error',
}

/**
 * The EventBus events the activity log records, by name. The backend forwards exactly these (each
 * must be an EventMap event) and the console describes each one, so an event added here is a
 * compile error on both sides until it is handled.
 */
export const ACTIVITY_EVENTS = [
  'chat.message',
  'command.executed',
  'twitch.follow',
  'twitch.subscribe',
  'twitch.raid',
  'twitch.cheer',
  'twitch.stream.online',
  'twitch.stream.offline',
  'twitch.ad.break',
  'stream.break.started',
  'stream.break.ended',
  'twitch.channelPoint.redemption',
  'obs.scene.changed',
  'obs.stream.stateChanged',
  'obs.record.stateChanged',
  'obs.sceneItem.stateChanged',
  'arduino.message',
  'integration.status',
  'platform.availability',
  'integration.error',
] as const;

export type ActivityEventName = (typeof ACTIVITY_EVENTS)[number];

export function isActivityEventName(event: string): event is ActivityEventName {
  return (ACTIVITY_EVENTS as readonly string[]).includes(event);
}

/**
 * One row of the activity feed. Same shape whether it came from a live broadcast or the DB.
 */
export const ActivityLogEntrySchema = z.strictObject({
  /** Unique identifier */
  id: z.string().min(1),

  /** Activity category */
  category: z.enum(ActivityCategory),

  /**
   * Fully-qualified source event name, e.g. 'twitch.follow'. One of ACTIVITY_EVENTS when it was
   * written, but a stored entry can outlive a renamed or retired event, so it is read as a string.
   */
  event: z.string().min(1),

  /** Category-specific payload (already serialized-safe: no Error objects, no functions) */
  data: z.record(z.string(), z.unknown()),

  /** Timestamp when the activity occurred */
  timestamp: z.number(),
});

export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;
