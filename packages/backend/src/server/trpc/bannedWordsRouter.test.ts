import 'reflect-metadata';
import { BAN_DURATION_MS } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { BannedWordRepository } from '../../database/repositories/BannedWordRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import { BannedWordList } from '../../features/chat/moderation/BannedWordList.js';
import { Logger } from '../../utils/Logger.js';
import { createBannedWordsRouter } from './bannedWordsRouter.js';
import { createCallerFactory } from './trpc.js';

let db: DatabaseManager;
let cleanup: () => Promise<void>;
let eventBus: EventBus;
let repository: BannedWordRepository;
let words: BannedWordList;
let controller: AbortController;

const caller = () =>
  createCallerFactory(createBannedWordsRouter(words, eventBus))(
    { consoleOrigin: null },
    { signal: controller.signal }
  );

const LAPSED = () => Date.now() - BAN_DURATION_MS - 1000;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDatabase());
  eventBus = new EventBus(new Logger({ level: 'silent' }));
  repository = new BannedWordRepository(db);
  words = new BannedWordList(eventBus, repository);
  controller = new AbortController();
});

afterEach(async () => {
  controller.abort();
  await cleanup();
});

describe('banned words router', () => {
  it('sends the list on subscribing and again when a viewer bans a word', async () => {
    const api = caller();
    words.ban('cheese', 'viewer');
    const updates = (await api.watch())[Symbol.asyncIterator]();
    expect((await updates.next()).value).toMatchObject([{ word: 'cheese', bannedBy: 'viewer' }]);

    const next = updates.next();
    words.ban('crackers', 'another');

    expect((await next).value).toMatchObject([{ word: 'cheese' }, { word: 'crackers' }]);
  });

  it('lists a lapsed word, with when its ban expired', async () => {
    const bannedAt = LAPSED();
    repository.ban('cheese', 'viewer', bannedAt);

    expect(await (await caller().watch())[Symbol.asyncIterator]().next()).toMatchObject({
      value: [{ word: 'cheese', bannedAt, expiresAt: bannedAt + BAN_DURATION_MS }],
    });
  });

  it("adds a word in the form chat is matched against, on the streamer's account", async () => {
    const left = await caller().add({ word: " Don't! ", wholeWord: true });

    expect(left).toMatchObject([{ word: 'dont', bannedBy: null, wholeWord: true }]);
  });

  it.each(['', '   ', '!!!', 'two words'])('refuses to add %j', async (word) => {
    await expect(caller().add({ word, wholeWord: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(words.list()).toEqual([]);
  });

  it('refuses to add a word already banned', async () => {
    words.ban('cheese', 'viewer');

    await expect(caller().add({ word: 'CHEESE', wholeWord: true })).rejects.toThrow(
      'already banned'
    );
    expect(words.list()).toMatchObject([{ bannedBy: 'viewer' }]);
  });

  it('adding a lapsed word bans it again', async () => {
    repository.ban('cheese', 'viewer', LAPSED());

    const left = await caller().add({ word: 'cheese', wholeWord: false });

    expect(left).toMatchObject([{ word: 'cheese', bannedBy: null }]);
    expect(words.isBanned('cheese')).toBe(true);
  });

  it('renames a word, keeping who banned it and when', async () => {
    repository.ban('chese', 'viewer', 1000);

    const left = await caller().update({ word: 'chese', newWord: 'Cheese', wholeWord: false });

    expect(left).toMatchObject([{ word: 'cheese', bannedBy: 'viewer', bannedAt: 1000 }]);
  });

  it('refuses to rename a word to one already listed, even a lapsed one', async () => {
    words.ban('chese', 'viewer');
    repository.ban('cheese', 'long ago', LAPSED());

    await expect(
      caller().update({ word: 'chese', newWord: 'cheese', wholeWord: false })
    ).rejects.toThrow('already on the list');
    expect(words.list().map((word) => word.word)).toContain('chese');
  });

  it('changes how a word matches without changing the word', async () => {
    words.ban('cheese', 'viewer');

    await expect(
      caller().update({ word: 'cheese', newWord: 'CHEESE!', wholeWord: true })
    ).resolves.toMatchObject([{ word: 'cheese', wholeWord: true }]);
  });

  it('starts a ban with no setting given by its length, as for a reward', () => {
    words.ban('hell', 'viewer');
    words.ban('spider', 'viewer');

    expect(words.list()).toMatchObject([
      { word: 'hell', wholeWord: true },
      { word: 'spider', wholeWord: false },
    ]);
  });

  it('keeps how a word matches when it is renewed', async () => {
    repository.ban('cheese', 'viewer', LAPSED(), true);

    expect((await caller().renew({ word: 'cheese' }))[0]?.wholeWord).toBe(true);
  });

  it('renews a lapsed ban, keeping who banned it', async () => {
    repository.ban('cheese', 'viewer', LAPSED());

    const [renewed] = await caller().renew({ word: 'cheese' });

    expect(renewed?.bannedBy).toBe('viewer');
    expect(renewed?.expiresAt).toBeGreaterThan(Date.now());
    expect(words.isBanned('cheese')).toBe(true);
  });

  it('deletes words, skipping ones already gone, and answers with the list it left', async () => {
    words.ban('keep', null);
    words.ban('drop', null);

    const left = await caller().delete({ words: ['drop', 'gone'] });

    expect(left).toMatchObject([{ word: 'keep' }]);
  });

  it('says so when a word was deleted by another console', async () => {
    await expect(
      caller().update({ word: 'gone', newWord: 'new', wholeWord: true })
    ).rejects.toThrow('no longer on the list');
    await expect(caller().renew({ word: 'gone' })).rejects.toThrow('no longer on the list');
  });

  it('rejects a delete of no words', async () => {
    await expect(caller().delete({ words: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
