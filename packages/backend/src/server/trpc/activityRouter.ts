import { ACTIVITY_EVENT_NAMES, type ActivityLogEntry, MAX_DATA_PAGE_SIZE } from '@turingmod/shared';
import { z } from 'zod';
import type { ActivityForwarder } from '../../activity/ActivityForwarder.js';
import type { ActivityLogRepository } from '../../database/repositories/ActivityLogRepository.js';
import { procedure, router } from './trpc.js';
import { events } from './watch.js';

/** How many stored entries a console's feed starts with. */
const SEED_LIMIT = 200;

/** What the feed sends: the stored log to start from, then each entry as it's made. */
export type ActivityFeedEvent =
  | { type: 'seed'; entries: ActivityLogEntry[] }
  | { type: 'entry'; entry: ActivityLogEntry };

/** A page of the stored log for History; see ActivityLogQuery. */
const HistoryQuerySchema = z.strictObject({
  events: z.array(z.enum(ACTIVITY_EVENT_NAMES)).min(1).exactOptional(),
  search: z.string().exactOptional(),
  since: z.number().exactOptional(),
  page: z.int().nonnegative(),
  pageSize: z.int().positive().max(MAX_DATA_PAGE_SIZE),
});

/** The Dashboard's live activity feed, and History's pages of the stored log. */
export function createActivityRouter(forwarder: ActivityForwarder, repo: ActivityLogRepository) {
  return router({
    /**
     * The most recent stored entries, newest first, then every entry as it's made, chat
     * included. Sent afresh on every subscribe, so a console that reconnects gets what was stored
     * meanwhile; chat isn't stored, so chat sent while it was disconnected is missed.
     */
    feed: procedure.subscription(async function* ({ signal }): AsyncGenerator<ActivityFeedEvent> {
      // One synchronous step (the repository is synchronous): no entry can be made between
      // reading the seed and subscribing, so none is missed and none arrives twice.
      const entries = repo.findRecent({ limit: SEED_LIMIT });
      const live = events<ActivityLogEntry>((onEntry) => forwarder.onEntry(onEntry), signal);
      try {
        yield { type: 'seed', entries };
        for await (const entry of live) {
          yield { type: 'entry', entry };
        }
      } finally {
        await live.return?.();
      }
    }),

    /**
     * One page of the stored log, newest first, as entries (chat isn't stored). A stored entry
     * that no longer fits the entry schema fails the read, naming it, rather than going missing.
     */
    history: procedure.input(HistoryQuerySchema).query(({ input }) => repo.findPage(input)),
  });
}
