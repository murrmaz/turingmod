import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { activityEntry as entry } from '@/testing/activity';
import {
  activityEventTone,
  dayDivider,
  FEED_CATEGORY_EVENTS,
  formatDay,
  formatUptime,
  matchesFeedQuery,
  toFeedRow,
} from './activityFormat';

const command = (data: Record<string, unknown>) =>
  entry('command.executed', {
    command: 'so',
    args: ['CoolRaider'],
    username: 'mod_kat',
    platform: 'twitch',
    ...data,
  });

describe('toFeedRow', () => {
  it('shows a command with its arguments and reply', () => {
    const row = toFeedRow(command({ success: true, message: 'Go check out CoolRaider' }));

    expect(row).toMatchObject({
      category: 'command',
      tone: 'command',
      title: '!so CoolRaider',
      detail: 'Go check out CoolRaider',
      user: 'mod_kat',
      platform: StreamingPlatform.TWITCH,
    });
  });

  it('marks a failed command red and gives the reason', () => {
    const row = toFeedRow(
      command({
        success: false,
        message: 'Nope',
        errorCode: 'API_ERROR',
        reason: 'Helix rejected the update',
      })
    );

    expect(row.tone).toBe('error');
    expect(row.detail).toBe('Failed: Helix rejected the update');
  });

  it('notes a simulated command', () => {
    expect(toFeedRow(command({ success: true, message: 'ok', isSimulation: true })).detail).toBe(
      'ok · simulated'
    );
  });

  it('files redemptions under rewards', () => {
    const row = toFeedRow(
      entry('twitch.channelPoint.redemption', {
        rewardTitle: 'Ban A Word',
        rewardCost: 2000,
        userDisplayName: 'quietfox',
        input: 'moist',
      })
    );

    expect(row).toMatchObject({ category: 'reward', title: 'Ban A Word', user: 'quietfox' });
    expect(row.detail).toContain('“moist”');
  });

  it('files follows, subs, raids and cheers under viewers', () => {
    for (const event of [
      'twitch.follow',
      'twitch.subscribe',
      'twitch.raid',
      'twitch.cheer',
    ] as const) {
      expect(toFeedRow(entry(event)).category).toBe('viewer');
    }
    expect(toFeedRow(entry('twitch.subscribe', { tier: '2000' })).detail).toBe('Tier 2');
  });

  it('files integration problems under system, in red', () => {
    const row = toFeedRow(
      entry('integration.status', { name: 'spotify-api', status: 'needs_reauth' })
    );

    expect(row).toMatchObject({ category: 'system', tone: 'error', title: 'spotify-api' });
    expect(row.detail).toBe('needs reauth');
  });

  it('names nobody for an anonymous cheer', () => {
    const row = toFeedRow(
      entry('twitch.cheer', { userId: null, userName: null, userDisplayName: null })
    );

    expect(row.user).toBe('Anonymous');
  });

  it('keeps chat in its own category', () => {
    const row = toFeedRow(
      entry('chat.message', { username: 'viewer', message: 'hi', platform: 'youtube' })
    );

    expect(row).toMatchObject({
      category: 'chat',
      title: 'hi',
      platform: StreamingPlatform.YOUTUBE,
    });
  });
});

describe('matchesFeedQuery', () => {
  it('matches event, detail and user case-insensitively', () => {
    const row = toFeedRow(command({ success: true, message: 'Shoutout posted' }));

    expect(matchesFeedQuery(row, 'COOLRAIDER')).toBe(true);
    expect(matchesFeedQuery(row, 'shoutout')).toBe(true);
    expect(matchesFeedQuery(row, 'mod_kat')).toBe(true);
    expect(matchesFeedQuery(row, 'spotify')).toBe(false);
  });
});

describe('formatUptime', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatUptime(((2 * 60 + 14) * 60 + 37) * 1000)).toBe('2:14:37');
  });
});

describe('toFeedRow for a device message', () => {
  it("shows a message's text", () => {
    expect(
      toFeedRow(entry('arduino.message', { type: 'log', text: 'servo 2 homed' }))
    ).toMatchObject({
      category: 'system',
      label: 'Arduino',
      title: 'log',
      detail: 'servo 2 homed',
    });
  });

  it("shows the fields of a type the console doesn't know", () => {
    const row = toFeedRow(
      entry('arduino.message', { type: 'rejected', id: 7, reason: 'busy', at: [0, 10] })
    );

    expect(row).toMatchObject({ title: 'rejected', detail: 'id 7 · reason busy · at [0,10]' });
  });
});

describe('stream entries', () => {
  const live = (data: Record<string, unknown>, timestamp: number) =>
    entry('platform.liveState', { platform: 'youtube', ...data }, { timestamp });

  it('says a stream started when it began about when it was seen', () => {
    const row = toFeedRow(live({ live: true, startedAt: 1_000_000 }, 1_060_000));

    expect(row).toMatchObject({
      title: 'Stream started',
      detail: '',
      platform: StreamingPlatform.YOUTUBE,
    });
  });

  it('says when a stream that was already running started', () => {
    const startedAt = new Date(2026, 9, 22, 13, 10).getTime();
    const row = toFeedRow(live({ live: true, startedAt }, startedAt + 3_600_000));

    expect(row).toMatchObject({ title: 'Stream live', detail: 'started 2026-10-22 13:10:00' });
  });

  it('says a stream ended', () => {
    expect(toFeedRow(live({ live: false, startedAt: null }, 0)).title).toBe('Stream ended');
  });
});

describe('day dividers', () => {
  const now = new Date(2026, 9, 24, 15, 0).getTime();
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
  const row = (timestamp: number) => toFeedRow(entry('twitch.follow', {}, { timestamp }));

  it('names today and yesterday, and dates the rest', () => {
    expect(formatDay(at(24, 9), now)).toMatch(/^Today · /);
    expect(formatDay(at(23, 23), now)).toMatch(/^Yesterday · /);
    expect(formatDay(at(22, 9), now)).not.toMatch(/Today|Yesterday/);
    expect(formatDay(new Date(2025, 2, 3).getTime(), now)).toContain('2025');
  });

  it('goes above the first row and wherever the day changes', () => {
    expect(dayDivider(row(at(24, 9)), undefined)).not.toBeNull();
    expect(dayDivider(row(at(24, 9)), row(at(24, 14)))).toBeNull();
    expect(dayDivider(row(at(23, 23)), row(at(24, 0)))).not.toBeNull();
  });
});

describe('FEED_CATEGORY_EVENTS', () => {
  it('lists each event under the category toFeedRow gives it', () => {
    for (const [category, events] of Object.entries(FEED_CATEGORY_EVENTS)) {
      for (const event of events) {
        expect(toFeedRow(entry(event)).category).toBe(category);
      }
    }
  });
});

describe('activityEventTone', () => {
  it("colours a recorded event's name by its category, and nothing else", () => {
    expect(activityEventTone('command.executed')).toBe('command');
    expect(activityEventTone('integration.error')).toBe('error');
    expect(activityEventTone('twitch.follow')).toBe('viewer');
    expect(activityEventTone('not.an.event')).toBeUndefined();
  });
});
