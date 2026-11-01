import { type ActivityLogEntry, MAX_DATA_PAGE_SIZE } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityForwarder } from '../../activity/ActivityForwarder.js';
import type {
  ActivityLogQuery,
  ActivityLogRepository,
} from '../../database/repositories/ActivityLogRepository.js';
import { createActivityRouter } from './activityRouter.js';
import { createCallerFactory } from './trpc.js';

const entry = (id: string): ActivityLogEntry => ({
  id,
  event: 'chat.message',
  data: {},
  timestamp: 0,
});

function setup(stored: ActivityLogEntry[]) {
  const listeners = new Set<(entry: ActivityLogEntry) => void>();
  const forwarder = {
    onEntry: (listener: (entry: ActivityLogEntry) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const repo = { findRecent: () => stored };
  const controller = new AbortController();
  const caller = createCallerFactory(
    createActivityRouter(
      forwarder as unknown as ActivityForwarder,
      repo as unknown as ActivityLogRepository
    )
  )({ consoleOrigin: null }, { signal: controller.signal });
  const emit = (made: ActivityLogEntry) => {
    for (const listener of listeners) {
      listener(made);
    }
  };
  return { caller, controller, emit, listenerCount: () => listeners.size };
}

describe('activity.feed', () => {
  it('starts with the stored log, then sends each entry as it is made', async () => {
    const { caller, controller, emit } = setup([entry('stored')]);
    const feed = (await caller.feed())[Symbol.asyncIterator]();

    expect((await feed.next()).value).toEqual({ type: 'seed', entries: [entry('stored')] });
    emit(entry('a'));
    emit(entry('b'));

    expect((await feed.next()).value).toEqual({ type: 'entry', entry: entry('a') });
    expect((await feed.next()).value).toEqual({ type: 'entry', entry: entry('b') });
    controller.abort();
  });

  it('keeps an entry made while the seed was being sent', async () => {
    const { caller, controller, emit } = setup([]);
    const feed = (await caller.feed())[Symbol.asyncIterator]();
    const seed = feed.next();
    emit(entry('meanwhile'));

    expect((await seed).value).toEqual({ type: 'seed', entries: [] });
    expect((await feed.next()).value).toEqual({ type: 'entry', entry: entry('meanwhile') });
    controller.abort();
  });

  it('stops listening once the console unsubscribes', async () => {
    const { caller, controller, listenerCount } = setup([]);
    const feed = (await caller.feed())[Symbol.asyncIterator]();
    await feed.next();
    const waiting = feed.next();

    controller.abort();

    expect((await waiting).done).toBe(true);
    expect(listenerCount()).toBe(0);
  });
});

describe('activity.history', () => {
  function historyCaller() {
    const findPage = vi.fn((_query: ActivityLogQuery) => ({
      entries: [entry('stored')],
      total: 1,
    }));
    const caller = createCallerFactory(
      createActivityRouter(
        {} as ActivityForwarder,
        { findPage } as unknown as ActivityLogRepository
      )
    )({ consoleOrigin: null });
    return { caller, findPage };
  }

  it('answers with the page the log reads for the query', async () => {
    const { caller, findPage } = historyCaller();
    const query = {
      events: ['twitch.follow' as const],
      search: 'ana',
      since: 10,
      page: 2,
      pageSize: 25,
    };

    await expect(caller.history(query)).resolves.toEqual({ entries: [entry('stored')], total: 1 });
    expect(findPage).toHaveBeenCalledWith(query);
  });

  it.each([
    ['an event the log does not record', { events: ['twitch.stream.online'] }],
    ['an empty list of events', { events: [] }],
    ['a negative page', { page: -1 }],
    ['a page larger than the data inspector allows', { pageSize: MAX_DATA_PAGE_SIZE + 1 }],
    ['an unknown field', { table: 'settings' }],
  ])('refuses %s', async (_name, change) => {
    const { caller, findPage } = historyCaller();

    await expect(caller.history({ page: 0, pageSize: 50, ...change } as never)).rejects.toThrow();
    expect(findPage).not.toHaveBeenCalled();
  });
});
