import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { IntervalMessageRepository } from '../../database/repositories/IntervalMessageRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import { IntervalMessages } from '../../features/chat/announcements/IntervalMessages.js';
import { Logger } from '../../utils/Logger.js';
import { createIntervalMessagesRouter } from './intervalMessagesRouter.js';
import { createCallerFactory } from './trpc.js';

let db: DatabaseManager;
let cleanup: () => Promise<void>;
let eventBus: EventBus;
let messages: IntervalMessages;
let controller: AbortController;

const caller = () =>
  createCallerFactory(createIntervalMessagesRouter(messages, eventBus))(
    { consoleOrigin: null },
    { signal: controller.signal }
  );

const idOf = (text: string) =>
  messages.rotation().messages.find((m) => m.message === text)?.id ?? 0;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDatabase());
  eventBus = new EventBus(new Logger({ level: 'silent' }));
  messages = new IntervalMessages(eventBus, new IntervalMessageRepository(db));
  controller = new AbortController();
});

afterEach(async () => {
  controller.abort();
  await cleanup();
});

describe('interval messages router', () => {
  it('sends the rotation on subscribing and again when it changes', async () => {
    const api = caller();
    messages.add('a');
    const updates = (await api.watch())[Symbol.asyncIterator]();
    expect((await updates.next()).value).toMatchObject({ messages: [{ message: 'a' }] });

    const next = updates.next();
    messages.add('b');

    expect((await next).value).toMatchObject({
      messages: [{ message: 'a' }, { message: 'b' }],
    });
  });

  it('tells watchers when a message is posted', async () => {
    const api = caller();
    messages.add('a');
    const updates = (await api.watch())[Symbol.asyncIterator]();
    await updates.next();

    const next = updates.next();
    messages.markPosted(idOf('a'));

    expect((await next).value).toMatchObject({ messages: [{ lastPostedAt: expect.any(Number) }] });
  });

  it('adds a message, trimmed, and answers with the rotation it left', async () => {
    const left = await caller().add({ message: '  Join the Discord ' });

    expect(left.messages).toMatchObject([{ message: 'Join the Discord' }]);
    expect(left.nextId).toBe(left.messages[0]?.id);
  });

  it.each(['', '   ', '!discord', '/me waves', 'x'.repeat(501)])(
    'refuses to add %j',
    async (message) => {
      await expect(caller().add({ message })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(messages.rotation().messages).toEqual([]);
    }
  );

  it('updates a message, holding the new text to the same rules', async () => {
    messages.add('a');
    const id = idOf('a');

    expect((await caller().update({ id, message: 'b' })).messages).toMatchObject([
      { message: 'b' },
    ]);
    await expect(caller().update({ id, message: '!b' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('pauses a message, moving next on to the one after it', async () => {
    messages.add('a');
    messages.add('b');

    const left = await caller().setEnabled({ id: idOf('a'), enabled: false });

    expect(left.messages[0]?.enabled).toBe(false);
    expect(left.nextId).toBe(idOf('b'));
  });

  it('answers with no next message when every one is paused', async () => {
    messages.add('a');

    const left = await caller().setEnabled({ id: idOf('a'), enabled: false });

    expect(left.nextId).toBeNull();
  });

  it('moves a message', async () => {
    messages.add('a');
    messages.add('b');

    const left = await caller().move({ id: idOf('b'), direction: 'up' });

    expect(left.messages.map((m) => m.message)).toEqual(['b', 'a']);
  });

  it('deletes messages and answers with the rotation it left', async () => {
    messages.add('keep');
    messages.add('drop');

    const left = await caller().delete({ ids: [idOf('drop')] });

    expect(left.messages).toMatchObject([{ message: 'keep' }]);
  });

  it('says so when a message was deleted by another console', async () => {
    await expect(caller().update({ id: 99, message: 'b' })).rejects.toThrow('no longer exists');
    await expect(caller().setEnabled({ id: 99, enabled: true })).rejects.toThrow(
      'no longer exists'
    );
    await expect(caller().move({ id: 99, direction: 'up' })).rejects.toThrow('no longer exists');
  });

  it('rejects a delete of no messages', async () => {
    await expect(caller().delete({ ids: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
