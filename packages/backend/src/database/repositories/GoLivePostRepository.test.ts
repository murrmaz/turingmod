import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseManager } from '../DatabaseManager.js';
import { type GoLivePost, GoLivePostRepository } from './GoLivePostRepository.js';
import { createTestDatabase } from './testDatabase.js';

describe('GoLivePostRepository', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let repo: GoLivePostRepository;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    repo = new GoLivePostRepository(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  const post: GoLivePost = {
    channelId: '123456789012345678',
    messageId: '900000000000000001',
    lastLiveAt: 2000,
    previewStamp: 1000,
    stream: {
      channelName: 'Pope_Pontius',
      title: 'Speedruns',
      game: null,
      links: [{ platform: StreamingPlatform.TWITCH, url: 'https://www.twitch.tv/pope_pontius' }],
      previewImageUrl: null,
      startedAt: 1000,
    },
  };

  it('round-trips a post, replaces it on the next save, and forgets it when cleared', () => {
    expect(repo.get()).toBeNull();

    repo.save(post);
    expect(repo.get()).toEqual(post);

    repo.save({ ...post, lastLiveAt: 3000 });
    expect(repo.get()?.lastLiveAt).toBe(3000);

    repo.clear();
    expect(repo.get()).toBeNull();
  });

  it('refuses a stored post that does not fit', () => {
    db.run('INSERT INTO go_live_post (id, post, saved_at) VALUES (1, ?, 0)', [
      JSON.stringify({ channelId: '1' }),
    ]);

    // Named field by field, since the message reaches the streamer's activity log.
    expect(() => repo.get()).toThrow(/stored go-live post is not valid[\s\S]*lastLiveAt/);
  });

  it('refuses to store a post that does not fit', () => {
    expect(() => repo.save({ ...post, lastLiveAt: 1.5 })).toThrow(/lastLiveAt/);
    expect(repo.get()).toBeNull();
  });
});
