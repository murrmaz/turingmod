import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * Tables holding data that individual features own: the words viewers have banned with the
 * "Ban A Word" reward, named counters (deaths, voice cracks), and the announcements posted on a
 * rotation. Each holds data only; the behaviour around it lives in code.
 */
export const featureData: Migration = {
  version: 2,
  name: 'feature_data',

  up(db: DatabaseManager): void {
    // Words are stored lowercased; NOCASE also keeps "Word" and "word" from coexisting.
    db.exec(`
      CREATE TABLE banned_words (
        word TEXT PRIMARY KEY COLLATE NOCASE,
        banned_by TEXT,
        banned_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Posted in id order, so the rotation follows the order messages were added.
    db.exec(`
      CREATE TABLE interval_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        message TEXT NOT NULL,
        created_by TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  },

  down(db: DatabaseManager): void {
    db.exec('DROP TABLE IF EXISTS interval_messages');
    db.exec('DROP TABLE IF EXISTS counters');
    db.exec('DROP TABLE IF EXISTS banned_words');
  },
};
