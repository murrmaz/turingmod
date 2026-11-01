import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { type FeedRow, toFeedRow } from './activityFormat';
import { countEvents, showsUnder, streamStartedAt } from './liveFeed';

function row(event: 'chat.message' | 'twitch.follow', timestamp: number): FeedRow {
  return toFeedRow({ id: `${event}-${timestamp}`, event, data: {}, timestamp });
}

describe('showsUnder', () => {
  it('shows everything but chat under All, and only its own category under a tab', () => {
    expect(showsUnder(row('twitch.follow', 1), 'all')).toBe(true);
    expect(showsUnder(row('chat.message', 1), 'all')).toBe(false);
    expect(showsUnder(row('chat.message', 1), 'chat')).toBe(true);
    expect(showsUnder(row('twitch.follow', 1), 'chat')).toBe(false);
  });
});

describe('streamStartedAt', () => {
  const { TWITCH, YOUTUBE } = StreamingPlatform;

  it('is when the first live platform went live', () => {
    expect(
      streamStartedAt([
        { platform: TWITCH, live: true, startedAt: 500 },
        { platform: YOUTUBE, live: true, startedAt: 200 },
      ])
    ).toBe(200);
  });

  it('ignores platforms that are offline or say nothing of when they started', () => {
    expect(
      streamStartedAt([
        { platform: TWITCH, live: false, startedAt: 100 },
        { platform: YOUTUBE, live: true, startedAt: null },
      ])
    ).toBeNull();
  });
});

describe('countEvents', () => {
  const rows = [row('twitch.follow', 10), row('chat.message', 20), row('twitch.follow', 30)];

  it('counts every event but chat, or only those since a time', () => {
    expect(countEvents(rows, null)).toBe(2);
    expect(countEvents(rows, 30)).toBe(1);
  });
});
