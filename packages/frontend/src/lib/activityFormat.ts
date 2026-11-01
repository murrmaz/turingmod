import type { ActivityEventName, ActivityLogEntry } from '@turingmod/shared';
import {
  ACTIVITY_EVENT_CATEGORIES,
  ActivityCategory,
  IntegrationStatus,
  StreamingPlatform,
} from '@turingmod/shared';
import type { Tone } from './tone';

/**
 * The feed's own categories, which the console filters by. Finer than the backend's
 * `ActivityCategory` (which only separates chat, commands, events, status and errors), and
 * worked out from the event name, so the backend needs no knowledge of how the console groups
 * things.
 */
export type FeedCategory = 'command' | 'reward' | 'viewer' | 'system' | 'chat';

/** The colour a row's badge takes: its category's, or red when something failed. */
export type FeedTone = FeedCategory | 'error';

/** One activity entry as the feed and History tables show it. */
export interface FeedRow {
  id: string;
  timestamp: number;
  category: FeedCategory;
  tone: FeedTone;
  /** Short badge text, e.g. "Raid" or "Command" */
  label: string;
  /** What happened, e.g. "!so CoolRaider" or "Barrel Roll" */
  title: string;
  /** More about it; empty when there's nothing to add */
  detail: string;
  /** Who did it; empty for things nobody did (status changes, ads) */
  user: string;
  platform: StreamingPlatform | null;
  entry: ActivityLogEntry;
}

export const FEED_CATEGORY_LABELS: Record<FeedCategory, string> = {
  command: 'Commands',
  reward: 'Rewards',
  viewer: 'Viewers',
  system: 'System',
  chat: 'Chat',
};

/**
 * A stream that started this long before TuringMod saw it go live was already running (TuringMod
 * restarted, or the platform came back), so its entry says when it started instead.
 */
const STARTED_JUST_NOW_MS = 5 * 60_000;

/**
 * The stored events in each category, for filtering the stored log by category on the server.
 * Chat isn't stored. Kept in step with `toFeedRow` by a test.
 */
export const FEED_CATEGORY_EVENTS: Record<Exclude<FeedCategory, 'chat'>, ActivityEventName[]> = {
  command: ['command.executed'],
  reward: ['twitch.channelPoint.redemption'],
  viewer: ['twitch.follow', 'twitch.subscribe', 'twitch.raid', 'twitch.cheer'],
  system: [
    'platform.liveState',
    'twitch.ad.break',
    'stream.break.started',
    'stream.break.ended',
    'obs.scene.changed',
    'obs.stream.stateChanged',
    'obs.record.stateChanged',
    'obs.sceneItem.stateChanged',
    'integration.status',
    'platform.availability',
    'integration.error',
  ],
};

function join(...parts: (string | null | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function seconds(value: number): string {
  return value >= 60 && value % 60 === 0 ? `${value / 60} min` : `${value}s`;
}

/** An OBS output's state as a word, e.g. `OBS_WEBSOCKET_OUTPUT_STARTED` as `started`. */
function outputState(state: string): string {
  return state.replace('OBS_WEBSOCKET_OUTPUT_', '').toLowerCase();
}

/**
 * What a device message carries besides its type: a `text` field as it is, and any others as
 * `name value`, so a type the console doesn't know (`{"type":"button","id":2}`) still shows them.
 */
function deviceFields(data: Record<string, unknown>): string {
  return join(
    ...Object.entries(data).map(([name, value]) => {
      if (name === 'type') {
        return null;
      }
      if (name === 'text' && typeof value === 'string') {
        return value;
      }
      return `${name} ${typeof value === 'string' ? value : JSON.stringify(value)}`;
    })
  );
}

type Described = Omit<FeedRow, 'id' | 'timestamp' | 'entry'>;

function system(label: string, title: string, detail = '', tone: FeedTone = 'system'): Described {
  return { category: 'system', tone, label, title, detail, user: '', platform: null };
}

/**
 * How each recorded event reads. Every name in ACTIVITY_EVENT_CATEGORIES needs a case, which the
 * compiler enforces (the switch must return on every path), and checking `event` gives `data` the
 * fields of that event's payload.
 */
function describe({ event, data, timestamp }: ActivityLogEntry): Described {
  const twitch = StreamingPlatform.TWITCH;

  switch (event) {
    case 'chat.message':
      return {
        category: 'chat',
        tone: 'chat',
        label: 'Chat',
        title: data.message,
        detail: '',
        user: data.username,
        platform: data.platform,
      };

    case 'command.executed':
      return {
        category: 'command',
        tone: data.success ? 'command' : 'error',
        label: 'Command',
        title: [`!${data.command}`, ...data.args].join(' '),
        detail: join(
          data.success ? data.message : `Failed: ${data.reason}`,
          data.isSimulation && 'simulated'
        ),
        user: data.username,
        platform: data.platform,
      };

    case 'twitch.channelPoint.redemption':
      return {
        category: 'reward',
        tone: 'reward',
        label: 'Reward',
        title: data.rewardTitle,
        detail: join(data.input && `“${data.input}”`, `${data.rewardCost.toLocaleString()} pts`),
        user: data.userDisplayName,
        platform: twitch,
      };

    case 'twitch.follow':
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Follow',
        title: 'Follow',
        detail: '',
        user: data.userDisplayName,
        platform: twitch,
      };

    case 'twitch.subscribe': {
      const tier = Number(data.tier);
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Sub',
        title: data.isGift ? 'Gifted sub' : 'Subscription',
        detail: Number.isFinite(tier) && tier > 0 ? `Tier ${tier / 1000}` : '',
        user: data.userDisplayName,
        platform: twitch,
      };
    }

    case 'twitch.raid':
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Raid',
        title: 'Raid',
        detail: `${data.viewers.toLocaleString()} viewers`,
        user: data.fromBroadcasterDisplayName,
        platform: twitch,
      };

    case 'twitch.cheer':
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Cheer',
        title: `${data.bits.toLocaleString()} bits`,
        detail: data.message,
        user: data.userDisplayName ?? 'Anonymous',
        platform: twitch,
      };

    case 'twitch.ad.break':
      return {
        ...system(
          'Ad',
          'Ad break',
          join(seconds(data.durationSeconds), data.isAutomatic ? 'automatic' : 'started by hand')
        ),
        platform: twitch,
      };

    case 'stream.break.started':
    case 'stream.break.ended':
      return system(
        'Break',
        event === 'stream.break.started' ? 'Break started' : 'Break ended',
        join(data.reason === 'ad' ? 'ad break' : 'manual', seconds(data.durationSeconds))
      );

    case 'obs.scene.changed':
      return system('OBS', 'Scene changed', data.sceneName);
    case 'obs.stream.stateChanged':
      return system('OBS', 'Stream output', outputState(data.outputState));
    case 'obs.record.stateChanged':
      return system('OBS', 'Recording', outputState(data.outputState));
    case 'obs.sceneItem.stateChanged':
      return system(
        'OBS',
        data.sceneItemEnabled ? 'Source shown' : 'Source hidden',
        data.sceneName
      );

    case 'arduino.message':
      return system('Arduino', data.type, deviceFields(data));

    case 'integration.status': {
      const failed =
        data.status === IntegrationStatus.ERROR || data.status === IntegrationStatus.NEEDS_REAUTH;
      return system(
        'Status',
        data.name,
        data.status.replace('_', ' '),
        failed ? 'error' : 'system'
      );
    }

    case 'platform.availability':
      return {
        ...system(
          'Platform',
          data.available ? 'Platform available' : 'Platform unavailable',
          data.reason ?? '',
          data.available ? 'system' : 'error'
        ),
        platform: data.platform,
      };

    case 'platform.liveState': {
      const { platform, live, startedAt } = data;
      if (!live) {
        return { ...system('Stream', 'Stream ended'), platform };
      }
      if (startedAt === null || timestamp - startedAt < STARTED_JUST_NOW_MS) {
        return { ...system('Stream', 'Stream started'), platform };
      }
      return {
        ...system('Stream', 'Stream live', `started ${formatDateTime(startedAt)}`),
        platform,
      };
    }

    case 'integration.error':
      return system('Error', data.name, data.message, 'error');
  }
}

/** Describe one activity entry for the feed. */
export function toFeedRow(entry: ActivityLogEntry): FeedRow {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    entry,
    ...describe(entry),
  };
}

/** Whether a row matches the feed's text filter: event, detail and user, case-insensitively. */
export function matchesFeedQuery(row: FeedRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [row.title, row.detail, row.user, row.label].some((field) =>
    field.toLowerCase().includes(needle)
  );
}

/** `HH:MM:SS` in local time. */
export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** `YYYY-MM-DD HH:MM:SS` in local time. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(timestamp)}`;
}

/** The day a timestamp falls on, in local time, as `YYYY-MM-DD`: equal for any two on one day. */
function dayOf(timestamp: number): string {
  return formatDateTime(timestamp).slice(0, 10);
}

/** The day a timestamp falls on, as the activity tables' dividers name it. */
export function formatDay(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const named = date.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
  if (dayOf(timestamp) === dayOf(now)) {
    return `Today · ${named}`;
  }
  if (dayOf(timestamp) === dayOf(yesterday.getTime())) {
    return `Yesterday · ${named}`;
  }
  return named;
}

/**
 * The divider above an activity row: its day, where that differs from the row before it (and
 * above the first row). Rows show only the time, so this is what says which day they're on.
 */
export function dayDivider(row: FeedRow, previous: FeedRow | undefined): string | null {
  return previous && dayOf(previous.timestamp) === dayOf(row.timestamp)
    ? null
    : formatDay(row.timestamp);
}

/** `H:MM:SS` for a duration in milliseconds. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const CATEGORY_TONES = {
  [ActivityCategory.COMMAND]: 'command',
  [ActivityCategory.EVENT]: 'viewer',
  [ActivityCategory.STATUS]: 'idle',
  [ActivityCategory.ERROR]: 'error',
  [ActivityCategory.CHAT]: 'chat',
} satisfies Record<ActivityCategory, Tone>;

/**
 * The colour of an activity event's name where the stored log shows it raw (the Data page),
 * by the event's category; undefined for a value that's no recorded event.
 */
export function activityEventTone(value: string): Tone | undefined {
  const category = Object.entries(ACTIVITY_EVENT_CATEGORIES).find(
    ([event]) => event === value
  )?.[1];
  return category === undefined ? undefined : CATEGORY_TONES[category];
}
