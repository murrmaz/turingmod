import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../database/DatabaseManager.js';
import { IntervalMessageRepository } from '../database/repositories/IntervalMessageRepository.js';
import { createTestDatabase } from '../database/repositories/testDatabase.js';
import type { MirrorResult, StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import { ANNOUNCEMENT_INTERVAL_MS, IntervalAnnouncer } from './IntervalAnnouncer.js';

describe('IntervalAnnouncer', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let messages: IntervalMessageRepository;
  let posted: string[];
  let live: boolean;
  let announcer: IntervalAnnouncer;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    messages = new IntervalMessageRepository(db);
    posted = [];
    live = true;
    const streamControl = {
      announce: (messageFor: (platform: StreamingPlatform) => string | null) => {
        const result: MirrorResult = { updated: [], failures: [] };
        if (live) {
          posted.push(messageFor(StreamingPlatform.TWITCH) ?? '');
          result.updated.push(StreamingPlatform.TWITCH);
        }
        return Promise.resolve(result);
      },
    };
    announcer = new IntervalAnnouncer(
      messages,
      streamControl as unknown as StreamControlService,
      new Logger({ level: 'silent' })
    );
  });

  afterEach(async () => {
    announcer.stop();
    vi.useRealTimers();
    await cleanup();
  });

  it('cycles through the messages in the order they were added', async () => {
    await messages.add('socials', 'Follow me', null);
    await messages.add('discord', 'Join the Discord', null);

    for (let i = 0; i < 3; i++) await announcer.announceNext();

    expect(posted).toEqual(['Follow me', 'Join the Discord', 'Follow me']);
  });

  it("doesn't advance the rotation while nothing is live", async () => {
    await messages.add('socials', 'Follow me', null);
    await messages.add('discord', 'Join the Discord', null);

    live = false;
    expect(await announcer.announceNext()).toBe(false);
    live = true;
    await announcer.announceNext();

    expect(posted).toEqual(['Follow me']);
  });

  it('copes with an empty or shrinking rotation', async () => {
    expect(await announcer.announceNext()).toBe(false);

    await messages.add('a', 'A', null);
    await messages.add('b', 'B', null);
    await announcer.announceNext();
    await announcer.announceNext();
    await messages.remove('b');
    await announcer.announceNext();

    expect(posted).toEqual(['A', 'B', 'A']);
  });

  it('posts every half hour once started', async () => {
    vi.useFakeTimers();
    await messages.add('socials', 'Follow me', null);
    announcer.start();

    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_INTERVAL_MS - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(posted).toEqual(['Follow me']));
  });
});
