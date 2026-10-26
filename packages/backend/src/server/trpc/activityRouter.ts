import type { ActivityLogEntry } from '@turingmod/shared';
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

/** The Dashboard's live activity feed. */
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
  });
}
