import 'reflect-metadata';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ChatMessageEvent } from '../core/events.js';
import type { Logger } from '../utils/Logger.js';
import { OwnChatMessages } from './OwnChatMessages.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

function message(overrides: Partial<ChatMessageEvent> = {}): ChatMessageEvent {
  return {
    platform: StreamingPlatform.TWITCH,
    platformUserId: 'broadcaster-id',
    username: 'streamer',
    message: 'delvod',
    permissionLevel: PermissionLevel.BROADCASTER,
    badges: ['broadcaster'],
    timestamp: 0,
    messageId: 'msg-1',
    channelId: 'broadcaster-id',
    ...overrides,
  };
}

function setup() {
  const logger = makeLogger();
  const bus = new EventBus(logger);
  const own = new OwnChatMessages(bus, logger);
  own.start();
  const delivered: ChatMessageEvent[] = [];
  bus.on('chat.message', (event) => {
    delivered.push(event);
  });
  return { bus, own, delivered };
}

describe('OwnChatMessages', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a message TuringMod sent and passes everything else on', async () => {
    const { bus, own, delivered } = setup();
    await own.record(StreamingPlatform.TWITCH, () => Promise.resolve('msg-1'));

    await bus.emit('chat.received', message());
    await bus.emit('chat.received', message({ messageId: 'msg-2', message: '!title typed' }));

    expect(delivered.map((event) => event.messageId)).toEqual(['msg-2']);
  });

  it('drops a message that arrives before the send that posted it returns', async () => {
    const { bus, own, delivered } = setup();
    let respond!: (id: string) => void;
    const sending = own.record(
      StreamingPlatform.TWITCH,
      () => new Promise<string>((resolve) => (respond = resolve))
    );

    const ingest = bus.emit('chat.received', message());
    respond('msg-1');
    await Promise.all([sending, ingest]);

    expect(delivered).toEqual([]);
  });

  it('does not hold up other people while a send is in flight', async () => {
    const { bus, own, delivered } = setup();
    void own.record(StreamingPlatform.TWITCH, () => new Promise<string>(() => {}));

    await bus.emit(
      'chat.received',
      message({ permissionLevel: PermissionLevel.VIEWER, platformUserId: 'viewer' })
    );

    expect(delivered).toHaveLength(1);
  });

  it('keys ids by platform', async () => {
    const { bus, own, delivered } = setup();
    await own.record(StreamingPlatform.YOUTUBE, () => Promise.resolve('msg-1'));

    await bus.emit('chat.received', message());

    expect(delivered).toHaveLength(1);
  });

  it('still judges later messages after a send fails', async () => {
    const { bus, own, delivered } = setup();
    await expect(
      own.record(StreamingPlatform.TWITCH, () => Promise.reject(new Error('rate limited')))
    ).rejects.toThrow('rate limited');

    await bus.emit('chat.received', message());

    expect(delivered).toHaveLength(1);
  });

  it('forgets ids after the retention window', async () => {
    vi.useFakeTimers();
    const { bus, own, delivered } = setup();
    await own.record(StreamingPlatform.TWITCH, () => Promise.resolve('old'));
    vi.advanceTimersByTime(OwnChatMessages.RETENTION_MS + 1);
    await own.record(StreamingPlatform.TWITCH, () => Promise.resolve('new'));

    await bus.emit('chat.received', message({ messageId: 'old' }));
    await bus.emit('chat.received', message({ messageId: 'new' }));

    expect(delivered.map((event) => event.messageId)).toEqual(['old']);
  });

  describe('a message the platform gives no id for', () => {
    const announcement = message({ message: 'Follow me', messageId: 'echo-1' });

    it('recognizes its echo by its wording, even one arriving before the send returns', async () => {
      const { own } = setup();
      let finishSend = () => {};

      const sending = own.recordText(
        StreamingPlatform.TWITCH,
        'Follow me',
        () =>
          new Promise<void>((resolve) => {
            finishSend = resolve;
          })
      );
      expect(await own.isOwn(announcement)).toBe(true);

      finishSend();
      await sending;
    });

    it('recognizes it once, so the streamer can say the same thing afterwards', async () => {
      const { own } = setup();
      await own.recordText(StreamingPlatform.TWITCH, 'Follow me', () => Promise.resolve());

      expect(await own.isOwn(announcement)).toBe(true);
      expect(await own.isOwn({ ...announcement, messageId: 'typed-1' })).toBe(false);
    });

    it('ignores the same words from another platform or another person', async () => {
      const { own } = setup();
      await own.recordText(StreamingPlatform.TWITCH, 'Follow me', () => Promise.resolve());

      expect(await own.isOwn({ ...announcement, platform: StreamingPlatform.YOUTUBE })).toBe(false);
      expect(await own.isOwn({ ...announcement, permissionLevel: PermissionLevel.VIEWER })).toBe(
        false
      );
    });

    it('forgets a send that failed, and rethrows', async () => {
      const { own } = setup();
      const failed = own.recordText(StreamingPlatform.TWITCH, 'Follow me', () =>
        Promise.reject(new Error('Twitch answered 500'))
      );

      await expect(failed).rejects.toThrow('Twitch answered 500');
      expect(await own.isOwn(announcement)).toBe(false);
    });

    it('forgets it after the retention time, even if nothing else has been sent', async () => {
      vi.useFakeTimers();
      const { own } = setup();
      await own.recordText(StreamingPlatform.TWITCH, 'Follow me', () => Promise.resolve());
      vi.advanceTimersByTime(OwnChatMessages.RETENTION_MS + 1);

      expect(await own.isOwn(announcement)).toBe(false);
    });

    it('counts the retention time from the latest time it was sent', async () => {
      vi.useFakeTimers();
      const { own } = setup();
      await own.recordText(StreamingPlatform.TWITCH, 'Follow me', () => Promise.resolve());
      vi.advanceTimersByTime(OwnChatMessages.RETENTION_MS);
      await own.recordText(StreamingPlatform.TWITCH, 'Follow me', () => Promise.resolve());
      vi.advanceTimersByTime(OwnChatMessages.RETENTION_MS);

      expect(await own.isOwn(announcement)).toBe(true);
    });

    it('forgets it after the retention time', async () => {
      vi.useFakeTimers();
      const { own } = setup();
      await own.recordText(StreamingPlatform.TWITCH, 'Follow me', () => Promise.resolve());
      vi.advanceTimersByTime(OwnChatMessages.RETENTION_MS + 1);
      await own.recordText(StreamingPlatform.TWITCH, 'Something else', () => Promise.resolve());

      expect(await own.isOwn(announcement)).toBe(false);
    });
  });
});
