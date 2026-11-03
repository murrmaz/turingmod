import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * Initial database schema
 * Creates every table for TuringMod
 */
export const initialSchema: Migration = {
  version: 1,
  name: 'initial_schema',

  up(db: DatabaseManager): void {
    // Integration state table - integration configurations and state
    db.exec(`
      CREATE TABLE integration_state (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Settings table - application settings
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Activity log table - denormalized feed of commands/events/status/errors (chat excluded).
    // An entry's category follows from its event (ACTIVITY_EVENT_CATEGORIES in shared).
    db.exec(`
      CREATE TABLE activity_log (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX idx_activity_log_timestamp
      ON activity_log(timestamp)
    `);

    // The words viewers have banned with the "Ban A Word" reward. Words are stored lowercased;
    // NOCASE also keeps "Word" and "word" from coexisting.
    db.exec(`
      CREATE TABLE banned_words (
        word TEXT PRIMARY KEY COLLATE NOCASE,
        banned_by TEXT,
        banned_at INTEGER NOT NULL
      )
    `);

    // Named counters (deaths, voice cracks)
    db.exec(`
      CREATE TABLE counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // The announcements posted on a rotation, in id order, so the rotation follows the order
    // messages were added.
    db.exec(`
      CREATE TABLE interval_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        message TEXT NOT NULL,
        created_by TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Viewers' suggestions for the bot, collected with `!sg`.
    db.exec(`
      CREATE TABLE suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        suggestion TEXT NOT NULL,
        suggested_by TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // What a break changed in OBS, kept until it has been put back, so a break that ends while OBS
    // is unreachable, or while TuringMod isn't running, is still undone. One row at most.
    db.exec(`
      CREATE TABLE obs_break_restore (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot TEXT NOT NULL,
        saved_at INTEGER NOT NULL
      )
    `);

    // The Discord go-live post of the stream in progress, kept until the stream has ended, so a
    // restart mid-stream goes on editing the same post rather than pinging everyone again. One row
    // at most.
    db.exec(`
      CREATE TABLE go_live_post (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        post TEXT NOT NULL,
        saved_at INTEGER NOT NULL
      )
    `);
  },
};
