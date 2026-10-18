import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  renderEndedPost,
  renderLivePost,
  type StreamSummary,
} from './goLivePost.js';

const { TWITCH, YOUTUBE } = StreamingPlatform;

const stream: StreamSummary = {
  channelName: 'Pope_Pontius',
  title: 'Speedruns',
  game: 'Celeste',
  links: [
    { platform: TWITCH, url: 'https://www.twitch.tv/pope_pontius' },
    { platform: YOUTUBE, url: 'https://www.youtube.com/watch?v=abc' },
  ],
  previewImageUrl: 'https://img.example/preview.jpg',
  startedAt: Date.UTC(2026, 9, 18, 18, 0),
};

describe('renderLivePost', () => {
  it('pings everyone and links each live platform', () => {
    const message = renderLivePost(stream, [TWITCH, YOUTUBE], 0);

    expect(message.pingEveryone).toBe(true);
    expect(message.content).toBe(
      [
        'Hey @everyone, Pope\\_Pontius is live! Come join:',
        '• Twitch: <https://www.twitch.tv/pope_pontius>',
        '• YouTube: <https://www.youtube.com/watch?v=abc>',
      ].join('\n')
    );
    expect(message.embeds).toEqual([
      {
        title: 'Speedruns',
        url: 'https://www.twitch.tv/pope_pontius',
        description: 'Playing **Celeste**',
        color: 0x9146ff,
        footer: { text: 'Live on Twitch · YouTube' },
        timestamp: '2026-10-18T18:00:00.000Z',
        image: { url: 'https://img.example/preview.jpg?t=0' },
      },
    ]);
  });

  it('leaves out a platform that is no longer live', () => {
    const message = renderLivePost(stream, [YOUTUBE], 0);

    expect(message.content).not.toContain('Twitch');
    expect(message.embeds[0]?.url).toBe('https://www.youtube.com/watch?v=abc');
  });

  it('names the stream after the streamer when it has no title', () => {
    const message = renderLivePost({ ...stream, title: null, game: null }, [TWITCH], 0);

    expect(message.embeds[0]?.title).toBe("Pope_Pontius's stream");
    expect(message.embeds[0]?.description).toBeUndefined();
  });

  it('keeps a long title within what Discord accepts', () => {
    const message = renderLivePost({ ...stream, title: 'x'.repeat(300) }, [TWITCH], 0);

    expect(message.embeds[0]?.title).toHaveLength(256);
  });
});

describe('renderEndedPost', () => {
  it('says how long the stream ran, without pinging or a preview', () => {
    const message = renderEndedPost(stream, stream.startedAt + (3 * 60 + 12) * 60_000);

    expect(message.pingEveryone).toBe(false);
    expect(message.content).toMatch(/^Pope\\_Pontius was live for 3h 12m\.\n/);
    expect(message.content).toContain('YouTube: <https://www.youtube.com/watch?v=abc>');
    expect(message.embeds[0]?.image).toBeUndefined();
    expect(message.embeds[0]?.footer).toEqual({ text: 'Stream ended' });
  });
});

describe('formatDuration', () => {
  it('shows hours only when there are some', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(60 * 60_000)).toBe('1h 0m');
    expect(formatDuration(-5)).toBe('0m');
  });
});
