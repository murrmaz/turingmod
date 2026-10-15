import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * What a break changed in OBS, kept until it has been put back, so a break that ends while OBS is
 * unreachable, or while TuringMod isn't running, is still undone. One row at most.
 */
export const obsBreakRestore: Migration = {
  version: 5,
  name: 'obs_break_restore',

  up(db: DatabaseManager): void {
    db.exec(`
      CREATE TABLE obs_break_restore (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot TEXT NOT NULL,
        saved_at INTEGER NOT NULL
      )
    `);
  },

  down(db: DatabaseManager): void {
    db.exec('DROP TABLE IF EXISTS obs_break_restore');
  },
};
