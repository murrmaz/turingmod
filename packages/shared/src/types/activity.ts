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
 * One row of the activity feed. Same shape whether it came from a live broadcast or the DB.
 */
export interface ActivityLogEntry {
  /** Unique identifier */
  id: string;

  /** Activity category */
  category: ActivityCategory;

  /** Fully-qualified source event name, e.g. 'twitch.follow', 'chat.message', 'command.executed' */
  event: string;

  /** Category-specific payload (already serialized-safe: no Error objects, no functions) */
  data: Record<string, unknown>;

  /** Timestamp when the activity occurred */
  timestamp: number;
}
