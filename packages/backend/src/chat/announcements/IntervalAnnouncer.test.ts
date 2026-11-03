import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { ServiceErrorEvent } from '../../core/events.js';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { IntervalMessageRepository } from '../../database/repositories/IntervalMessageRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import type { MirrorResult, StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import { ANNOUNCEMENT_INTERVAL_MS, IntervalAnnouncer } from './IntervalAnnouncer.js';

describe('IntervalAnnouncer', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let messages: IntervalMessageRepository;
  let posted: string[];
  let live: boolean;
  let announcer: IntervalAnnouncer;
  let reported: ReturnType<typeof vi.fn<(event: ServiceErrorEvent) => void>>;
  let announce: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    messages = new IntervalMessageRepository(db);
    posted = [];
    live = true;
    const streamControl = {
      announce: (messageFor: (platform: StreamingPlatform) => string | null) => {
        const result: MirrorResult = { updated: [], failures: [], skipped: [] };
        if (live) {
          posted.push(messageFor(StreamingPlatform.TWITCH) ?? '');
          result.updated.push(StreamingPlatform.TWITCH);
        }
        return Promise.resolve(result);
      },
    };
    const logger = new Logger({ level: 'silent' });
    const eventBus = new EventBus(logger);
    reported = vi.fn<(event: ServiceErrorEvent) => void>();
    eventBus.on('service.error', reported);
    announce = vi.fn(streamControl.announce);
    announcer = new IntervalAnnouncer(
      eventBus,
      messages,
      { announce } as unknown as StreamControlService,
      logger
    );
  });

  afterEach(async () => {
    announcer.stop();
    vi.useRealTimers();
    await cleanup();
  });

  it('cycles through the messages in the order they were added', async () => {
    messages.add('socials', 'Follow me', null);
    messages.add('discord', 'Join the Discord', null);

    for (let i = 0; i < 3; i++) await announcer.announceNext();

    expect(posted).toEqual(['Follow me', 'Join the Discord', 'Follow me']);
  });

  it("doesn't advance the rotation while nothing is live", async () => {
    messages.add('socials', 'Follow me', null);
    messages.add('discord', 'Join the Discord', null);

    live = false;
    expect(await announcer.announceNext()).toBe(false);
    live = true;
    await announcer.announceNext();

    expect(posted).toEqual(['Follow me']);
  });

  it('copes with an empty or shrinking rotation', async () => {
    expect(await announcer.announceNext()).toBe(false);

    messages.add('a', 'A', null);
    messages.add('b', 'B', null);
    await announcer.announceNext();
    await announcer.announceNext();
    messages.remove('b');
    await announcer.announceNext();

    expect(posted).toEqual(['A', 'B', 'A']);
  });

  it('posts every half hour once started', async () => {
    vi.useFakeTimers();
    messages.add('socials', 'Follow me', null);
    announcer.start();

    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_INTERVAL_MS - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(posted).toEqual(['Follow me']));
  });

  it('reports a platform that refused a message, once until one gets through', async () => {
    messages.add('socials', 'Follow me', null);
    const refused: MirrorResult = {
      updated: [],
      failures: [{ platform: StreamingPlatform.TWITCH, error: 'refused' }],
      skipped: [],
    };
    announce.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused);

    expect(await announcer.announceNext()).toBe(false);
    expect(await announcer.announceNext()).toBe(false);

    expect(reported).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledWith({
      service: 'Interval messages',
      message: 'Could not post an interval message on Twitch. refused',
    });
  });

  it('reports messages it cannot read', async () => {
    vi.spyOn(messages, 'list').mockImplementation(() => {
      throw new Error('database is locked');
    });

    expect(await announcer.announceNext()).toBe(false);

    expect(reported.mock.calls[0]?.[0].message).toMatch(/interval message.*database is locked/);
  });
});
