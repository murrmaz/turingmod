import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

const streamMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    youtube: () => ({ youtube: { v3: { liveChat: { messages: { stream: streamMock } } } } }),
  },
}));

const { YouTubeChatStream } = await import('./YouTubeChatStream.js');

/** Open a stream whose response body is `body`, and collect what the call emits. */
async function streamOf(body: string) {
  streamMock.mockResolvedValue({ data: Readable.from([Buffer.from(body)], { objectMode: false }) });
  const call = new YouTubeChatStream().stream('chat-1', {} as YouTubeOAuth2Client);
  const frames: unknown[] = [];
  const errors: unknown[] = [];
  call.on('data', (frame) => frames.push(frame));
  call.on('error', (error) => errors.push(error));
  await new Promise<void>((resolve) => {
    call.on('end', resolve);
    call.on('error', () => resolve());
  });
  return { frames, errors };
}

describe('YouTubeChatStream', () => {
  it('hands over each frame with the fields chat reads', async () => {
    const { frames, errors } = await streamOf(
      JSON.stringify({
        kind: 'youtube#liveChatMessageListResponse',
        nextPageToken: 'page-2',
        items: [
          { id: 'm1', snippet: { displayMessage: 'hi' }, authorDetails: { displayName: 'a' } },
        ],
      })
    );

    expect(errors).toEqual([]);
    expect(frames).toEqual([
      {
        nextPageToken: 'page-2',
        items: [
          { id: 'm1', snippet: { displayMessage: 'hi' }, authorDetails: { displayName: 'a' } },
        ],
      },
    ]);
  });

  it('ends the call with an error on a frame that is not the shape chat reads', async () => {
    const { frames, errors } = await streamOf(JSON.stringify({ items: 'not a list' }));

    expect(frames).toEqual([]);
    expect(String(errors[0])).toMatch(/Unexpected YouTube live chat frame[\s\S]*items/);
  });
});
