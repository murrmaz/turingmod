import { ActivityCategory, type ActivityLogEntry, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { FEED_CATEGORY_EVENTS, formatUptime, matchesFeedQuery, toFeedRow } from './activityFormat';

const entry = (
  event: string,
  data: Record<string, unknown>,
  category = ActivityCategory.EVENT
): ActivityLogEntry => ({ id: '1', category, event, data, timestamp: 0 });

const command = (data: Record<string, unknown>) =>
  entry(
    'command.executed',
    { command: 'so', args: ['CoolRaider'], username: 'mod_kat', platform: 'twitch', ...data },
    ActivityCategory.COMMAND
  );

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
      command({ success: false, message: 'Nope', reason: 'Helix rejected the update' })
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
    for (const event of ['twitch.follow', 'twitch.subscribe', 'twitch.raid', 'twitch.cheer']) {
      expect(toFeedRow(entry(event, {})).category).toBe('viewer');
    }
    expect(toFeedRow(entry('twitch.subscribe', { tier: '2000' })).detail).toBe('Tier 2');
  });

  it('files integration problems under system, in red', () => {
    const row = toFeedRow(
      entry(
        'integration.status',
        { name: 'spotify-api', status: 'needs_reauth' },
        ActivityCategory.STATUS
      )
    );

    expect(row).toMatchObject({ category: 'system', tone: 'error', title: 'spotify-api' });
    expect(row.detail).toBe('needs reauth');
  });

  it('keeps chat in its own category', () => {
    const row = toFeedRow(
      entry(
        'chat.message',
        { username: 'viewer', message: 'hi', platform: 'youtube' },
        ActivityCategory.CHAT
      )
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

describe('FEED_CATEGORY_EVENTS', () => {
  it('lists each event under the category toFeedRow gives it', () => {
    for (const [category, events] of Object.entries(FEED_CATEGORY_EVENTS)) {
      for (const event of events) {
        expect(toFeedRow(entry(event, {})).category).toBe(category);
      }
    }
  });
});
