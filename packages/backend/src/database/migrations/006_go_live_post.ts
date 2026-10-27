import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * The Discord go-live post of the stream in progress, kept until the stream has ended, so a
 * restart mid-stream goes on editing the same post rather than pinging everyone again. One row at
 * most.
 */
export const goLivePost: Migration = {
  version: 6,
  name: 'go_live_post',

  up(db: DatabaseManager): void {
    db.exec(`
      CREATE TABLE go_live_post (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        post TEXT NOT NULL,
        saved_at INTEGER NOT NULL
      )
    `);
  },
};
