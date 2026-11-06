import 'reflect-metadata';
import { ANNOUNCEMENT_INTERVAL_MS, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import type { ServiceErrorEvent } from '../../../core/events.js';
import type { DatabaseManager } from '../../../database/DatabaseManager.js';
import { IntervalMessageRepository } from '../../../database/repositories/IntervalMessageRepository.js';
import { createTestDatabase } from '../../../database/repositories/testDatabase.js';
import type {
  MirrorResult,
  StreamControlService,
} from '../../../platforms/StreamControlService.js';
import { fake } from '../../../testing.js';
import { Logger } from '../../../utils/Logger.js';
import { IntervalAnnouncer } from './IntervalAnnouncer.js';
import { IntervalMessages } from './IntervalMessages.js';

describe('IntervalAnnouncer', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let repository: IntervalMessageRepository;
  let messages: IntervalMessages;
  let eventBus: EventBus;
  let logger: Logger;
  let posted: string[];
  let live: boolean;
  let announcer: IntervalAnnouncer;
  let reported: ReturnType<typeof vi.fn<(event: ServiceErrorEvent) => void>>;
  let announce: ReturnType<typeof vi.fn>;

  const newAnnouncer = () =>
    new IntervalAnnouncer(eventBus, messages, fake<StreamControlService>()({ announce }), logger);

  /** Post the next message, a moment after the last: the rotation goes by when each was posted. */
  const post = () => {
    vi.advanceTimersByTime(1000);
    return announcer.announceNext();
  };

  const idOf = (text: string) => repository.list().find((m) => m.message === text)?.id ?? 0;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    repository = new IntervalMessageRepository(db);
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
    logger = new Logger({ level: 'silent' });
    eventBus = new EventBus(logger);
    messages = new IntervalMessages(eventBus, repository);
    reported = vi.fn<(event: ServiceErrorEvent) => void>();
    eventBus.on('service.error', reported);
    announce = vi.fn(streamControl.announce);
    announcer = newAnnouncer();
  });

  afterEach(async () => {
    announcer.stop();
    vi.useRealTimers();
    await cleanup();
  });

  it('cycles through the messages in rotation order', async () => {
    messages.add('Follow me');
    messages.add('Join the Discord');

    for (let i = 0; i < 3; i++) await post();

    expect(posted).toEqual(['Follow me', 'Join the Discord', 'Follow me']);
  });

  it("doesn't advance the rotation while nothing is live", async () => {
    messages.add('Follow me');
    messages.add('Join the Discord');

    live = false;
    expect(await post()).toBe(false);
    live = true;
    await post();

    expect(posted).toEqual(['Follow me']);
    expect(repository.list()[1]?.lastPostedAt).toBeNull();
  });

  it('copes with an empty or shrinking rotation', async () => {
    expect(await post()).toBe(false);

    messages.add('A');
    messages.add('B');
    await post();
    await post();
    messages.remove([idOf('B')]);
    await post();

    expect(posted).toEqual(['A', 'B', 'A']);
  });

  it('skips a paused message, and posts nothing when all are paused', async () => {
    for (const text of ['A', 'B', 'C']) messages.add(text);
    messages.setEnabled(idOf('B'), false);

    await post();
    await post();
    expect(posted).toEqual(['A', 'C']);

    messages.setEnabled(idOf('A'), false);
    messages.setEnabled(idOf('C'), false);
    expect(await post()).toBe(false);
    expect(posted).toEqual(['A', 'C']);
  });

  it('carries on after the last message posted when it has been paused', async () => {
    for (const text of ['A', 'B', 'C']) messages.add(text);
    await post();
    await post();
    messages.setEnabled(idOf('B'), false);

    await post();

    expect(posted).toEqual(['A', 'B', 'C']);
  });

  it('follows a new order', async () => {
    for (const text of ['A', 'B', 'C']) messages.add(text);
    await post();
    messages.move(idOf('C'), 'up');

    await post();

    expect(posted).toEqual(['A', 'C']);
  });

  it('picks up where it left off after a restart', async () => {
    for (const text of ['A', 'B', 'C']) messages.add(text);
    await post();
    await post();

    announcer.stop();
    announcer = newAnnouncer();
    await post();

    expect(posted).toEqual(['A', 'B', 'C']);
  });

  it("doesn't skip a message when an earlier one is deleted", async () => {
    for (const text of ['A', 'B', 'C', 'D']) messages.add(text);
    await post();
    await post();
    messages.remove([idOf('A')]);

    await post();

    expect(posted).toEqual(['A', 'B', 'C']);
  });

  it('moves on to the next message when the one last posted is deleted', async () => {
    for (const text of ['A', 'B', 'C']) messages.add(text);
    await post();
    await post();
    messages.remove([idOf('B')]);

    await post();

    expect(posted).toEqual(['A', 'B', 'C']);
  });

  it('records when a message was posted, and tells the console', async () => {
    messages.add('Follow me');
    const changed = vi.fn();
    eventBus.on('intervalMessages.changed', changed);

    await post();

    expect(repository.list()[0]?.lastPostedAt).toBe(Date.now());
    expect(changed).toHaveBeenCalledOnce();
  });

  it('survives a message deleted while it was being posted', async () => {
    messages.add('Follow me');
    announce.mockImplementationOnce(() => {
      messages.remove([idOf('Follow me')]);
      const result: MirrorResult = {
        updated: [StreamingPlatform.TWITCH],
        failures: [],
        skipped: [],
      };
      return Promise.resolve(result);
    });

    expect(await post()).toBe(true);
    expect(reported).not.toHaveBeenCalled();
  });

  it('posts every half hour once started', async () => {
    messages.add('Follow me');
    announcer.start();

    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_INTERVAL_MS - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(posted).toEqual(['Follow me']));
  });

  it('reports a platform that refused a message, once until one gets through', async () => {
    messages.add('Follow me');
    const refused: MirrorResult = {
      updated: [],
      failures: [{ platform: StreamingPlatform.TWITCH, error: 'refused' }],
      skipped: [],
    };
    announce.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused);

    expect(await post()).toBe(false);
    expect(await post()).toBe(false);

    expect(reported).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledWith({
      service: 'Interval messages',
      message: 'Could not post an interval message on Twitch. refused',
    });
  });

  it('reports messages it cannot read', async () => {
    vi.spyOn(repository, 'list').mockImplementation(() => {
      throw new Error('database is locked');
    });

    expect(await post()).toBe(false);

    expect(reported.mock.calls[0]?.[0].message).toMatch(/interval message.*database is locked/);
  });

  it('still counts a message as posted when recording that fails', async () => {
    messages.add('Follow me');
    vi.spyOn(repository, 'markPosted').mockImplementation(() => {
      throw new Error('database is locked');
    });

    expect(await post()).toBe(true);

    expect(posted).toEqual(['Follow me']);
    expect(reported.mock.calls[0]?.[0].message).toMatch(/posted but not recorded.*locked/);
  });
});
