import type { ActivityEventName, ActivityLogEntry } from '@turingmod/shared';
import { IntegrationStatus, isActivityEventName, StreamingPlatform } from '@turingmod/shared';

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
 * The stored events in each category, for filtering the stored log by category on the server.
 * Chat isn't stored. Kept in step with `toFeedRow` by a test.
 */
export const FEED_CATEGORY_EVENTS: Record<Exclude<FeedCategory, 'chat'>, ActivityEventName[]> = {
  command: ['command.executed'],
  reward: ['twitch.channelPoint.redemption'],
  viewer: ['twitch.follow', 'twitch.subscribe', 'twitch.raid', 'twitch.cheer'],
  system: [
    'twitch.stream.online',
    'twitch.stream.offline',
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

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function count(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === 'number' ? value : null;
}

function platformOf(data: Record<string, unknown>): StreamingPlatform | null {
  const value = data.platform;
  return Object.values(StreamingPlatform).find((platform) => platform === value) ?? null;
}

function join(...parts: (string | null | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function seconds(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  return value >= 60 && value % 60 === 0 ? `${value / 60} min` : `${value}s`;
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
 * How each recorded event reads. Every name in ACTIVITY_EVENTS needs a case, which the compiler
 * enforces (the switch must return on every path); anything else, such as an event stored before
 * it was renamed, shows as its bare name.
 */
function describe(event: string, data: Record<string, unknown>): Described {
  if (!isActivityEventName(event)) {
    return system('Event', event);
  }
  return describeEvent(event, data);
}

function describeEvent(event: ActivityEventName, data: Record<string, unknown>): Described {
  const twitch = StreamingPlatform.TWITCH;

  switch (event) {
    case 'chat.message':
      return {
        category: 'chat',
        tone: 'chat',
        label: 'Chat',
        title: text(data, 'message'),
        detail: '',
        user: text(data, 'username'),
        platform: platformOf(data),
      };

    case 'command.executed': {
      const args = Array.isArray(data.args) ? data.args.filter((a) => typeof a === 'string') : [];
      const succeeded = data.success === true;
      const outcome = succeeded
        ? text(data, 'message')
        : `Failed: ${text(data, 'reason') || text(data, 'message') || text(data, 'errorCode')}`;
      return {
        category: 'command',
        tone: succeeded ? 'command' : 'error',
        label: 'Command',
        title: [`!${text(data, 'command')}`, ...args].join(' '),
        detail: join(outcome, data.isSimulation === true && 'simulated'),
        user: text(data, 'username'),
        platform: platformOf(data),
      };
    }

    case 'twitch.channelPoint.redemption': {
      const cost = count(data, 'rewardCost');
      return {
        category: 'reward',
        tone: 'reward',
        label: 'Reward',
        title: text(data, 'rewardTitle'),
        detail: join(
          text(data, 'input') && `“${text(data, 'input')}”`,
          cost !== null && `${cost.toLocaleString()} pts`
        ),
        user: text(data, 'userDisplayName'),
        platform: twitch,
      };
    }

    case 'twitch.follow':
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Follow',
        title: 'Follow',
        detail: '',
        user: text(data, 'userDisplayName'),
        platform: twitch,
      };

    case 'twitch.subscribe': {
      const tier = Number(text(data, 'tier'));
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Sub',
        title: data.isGift === true ? 'Gifted sub' : 'Subscription',
        detail: Number.isFinite(tier) && tier > 0 ? `Tier ${tier / 1000}` : '',
        user: text(data, 'userDisplayName'),
        platform: twitch,
      };
    }

    case 'twitch.raid': {
      const viewers = count(data, 'viewers');
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Raid',
        title: 'Raid',
        detail: viewers === null ? '' : `${viewers.toLocaleString()} viewers`,
        user: text(data, 'fromBroadcasterDisplayName'),
        platform: twitch,
      };
    }

    case 'twitch.cheer': {
      const bits = count(data, 'bits');
      return {
        category: 'viewer',
        tone: 'viewer',
        label: 'Cheer',
        title: bits === null ? 'Cheer' : `${bits.toLocaleString()} bits`,
        detail: text(data, 'message'),
        user: text(data, 'userDisplayName') || 'Anonymous',
        platform: twitch,
      };
    }

    case 'twitch.stream.online':
      return { ...system('Stream', 'Stream online'), platform: twitch };
    case 'twitch.stream.offline':
      return { ...system('Stream', 'Stream offline'), platform: twitch };

    case 'twitch.ad.break':
      return {
        ...system(
          'Ad',
          'Ad break',
          join(
            seconds(count(data, 'durationSeconds')),
            data.isAutomatic === true ? 'automatic' : 'started by hand'
          )
        ),
        platform: twitch,
      };

    case 'stream.break.started':
    case 'stream.break.ended':
      return system(
        'Break',
        event === 'stream.break.started' ? 'Break started' : 'Break ended',
        join(
          text(data, 'reason') === 'ad' ? 'ad break' : 'manual',
          seconds(count(data, 'durationSeconds'))
        )
      );

    case 'obs.scene.changed':
      return system('OBS', 'Scene changed', text(data, 'sceneName'));
    case 'obs.stream.stateChanged':
      return system(
        'OBS',
        'Stream output',
        text(data, 'outputState').replace('OBS_WEBSOCKET_OUTPUT_', '').toLowerCase()
      );
    case 'obs.record.stateChanged':
      return system(
        'OBS',
        'Recording',
        text(data, 'outputState').replace('OBS_WEBSOCKET_OUTPUT_', '').toLowerCase()
      );
    case 'obs.sceneItem.stateChanged':
      return system(
        'OBS',
        data.sceneItemEnabled === true ? 'Source shown' : 'Source hidden',
        text(data, 'sceneName')
      );

    case 'arduino.message':
      return system('Arduino', text(data, 'type'), deviceFields(data));

    case 'integration.status': {
      const status = text(data, 'status');
      const failed =
        status === IntegrationStatus.ERROR || status === IntegrationStatus.NEEDS_REAUTH;
      return system(
        'Status',
        text(data, 'name'),
        status.replace('_', ' '),
        failed ? 'error' : 'system'
      );
    }

    case 'platform.availability': {
      const platform = platformOf(data);
      const available = data.available === true;
      return {
        ...system(
          'Platform',
          available ? 'Platform available' : 'Platform unavailable',
          text(data, 'reason'),
          available ? 'system' : 'error'
        ),
        platform,
      };
    }

    case 'integration.error':
      return system('Error', text(data, 'name'), text(data, 'message'), 'error');
  }
}

/** Describe one activity entry for the feed. */
export function toFeedRow(entry: ActivityLogEntry): FeedRow {
  return { id: entry.id, timestamp: entry.timestamp, entry, ...describe(entry.event, entry.data) };
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

/** `H:MM:SS` for a duration in milliseconds. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
