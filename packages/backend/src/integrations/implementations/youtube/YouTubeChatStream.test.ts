import { PassThrough, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Open a stream on a request that hasn't answered yet, and record everything the call emits. */
function open() {
  const call = new YouTubeChatStream().stream('chat-1', {} as YouTubeOAuth2Client, 'page-1');
  const frames: unknown[] = [];
  const errors: unknown[] = [];
  let ended = false;
  call.on('data', (frame) => frames.push(frame));
  call.on('error', (error) => errors.push(error));
  call.on('end', () => {
    ended = true;
  });
  return { call, frames, errors, ended: () => ended };
}

/** Open a stream whose response is a body the test goes on writing to. */
async function openBody() {
  const body = new PassThrough();
  streamMock.mockResolvedValue({ data: body });
  const opened = open();
  await settle();
  return { body, ...opened };
}

/** Let the request's promise and the body's queued events run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('YouTubeChatStream', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

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

  it('asks for a stream from the given page, with no timeout to end it early', async () => {
    await openBody();

    expect(streamMock).toHaveBeenCalledWith(
      { liveChatId: 'chat-1', part: ['snippet', 'authorDetails'], pageToken: 'page-1' },
      expect.objectContaining({ responseType: 'stream', timeout: 0 })
    );
  });

  it('puts a frame back together when a chunk splits it inside a character', async () => {
    const { body, frames, errors } = await openBody();
    const bytes = Buffer.from(JSON.stringify({ nextPageToken: '🎉' }));
    const insideTheEmoji = bytes.indexOf(0xf0) + 2;

    body.write(bytes.subarray(0, insideTheEmoji));
    await settle();
    expect(frames).toEqual([]);

    body.write(bytes.subarray(insideTheEmoji));
    await settle();
    expect(errors).toEqual([]);
    expect(frames).toEqual([{ nextPageToken: '🎉' }]);
  });

  it('closes the body and reports it when the body stops being JSON', async () => {
    const { body, frames, errors } = await openBody();

    body.write('{not json}');
    await settle();

    expect(frames).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(body.destroyed).toBe(true);
  });

  it('closes the body when a frame is not the shape chat reads', async () => {
    const { body, errors } = await openBody();

    body.write(JSON.stringify({ items: 'not a list' }));
    await settle();

    expect(errors).toHaveLength(1);
    expect(body.destroyed).toBe(true);
  });

  it('reports a body that fails partway through, after delivering what came first', async () => {
    const { body, frames, errors, ended } = await openBody();
    const failure = new Error('socket hang up');

    body.write(JSON.stringify({ nextPageToken: 'page-2' }));
    await settle();
    body.destroy(failure);
    await settle();

    expect(frames).toEqual([{ nextPageToken: 'page-2' }]);
    expect(errors).toEqual([failure]);
    expect(ended()).toBe(false);
  });

  it('reports the end of the body', async () => {
    const { body, ended, errors } = await openBody();

    body.end();
    await settle();

    expect(ended()).toBe(true);
    expect(errors).toEqual([]);
  });

  it('reports a request that fails to open', async () => {
    const failure = new Error('HTTP 403');
    streamMock.mockRejectedValue(failure);

    const { errors } = open();
    await settle();

    expect(errors).toEqual([failure]);
  });

  describe('cancel', () => {
    it('aborts the request, closes the body and goes quiet', async () => {
      const { body, call, frames, errors, ended } = await openBody();

      call.cancel();
      // What aborting a real body causes: its own error, which must not look like a stream failure.
      body.emit('error', new Error('aborted'));
      body.emit('end');
      await settle();

      expect(streamMock.mock.lastCall?.[1].signal.aborted).toBe(true);
      expect(body.destroyed).toBe(true);
      expect(frames).toEqual([]);
      expect(errors).toEqual([]);
      expect(ended()).toBe(false);
    });

    it('closes a body that arrives after the call was cancelled', async () => {
      const body = new PassThrough();
      let answer: (response: { data: PassThrough }) => void = () => {};
      streamMock.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        })
      );
      const { call, frames } = open();
      await settle();

      call.cancel();
      body.write(JSON.stringify({ nextPageToken: 'page-2' }));
      answer({ data: body });
      await settle();

      expect(body.destroyed).toBe(true);
      expect(frames).toEqual([]);
    });

    it('keeps quiet about the request it aborted', async () => {
      let fail: (error: Error) => void = () => {};
      streamMock.mockReturnValue(
        new Promise((_resolve, reject) => {
          fail = reject;
        })
      );
      const { call, errors } = open();
      await settle();

      call.cancel();
      fail(new Error('aborted'));
      await settle();

      expect(errors).toEqual([]);
    });
  });
});
