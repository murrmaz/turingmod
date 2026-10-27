import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * Initial database schema
 * Creates all base tables for TuringMod
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
        last_status TEXT NOT NULL,
        last_error TEXT,
        last_connected_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX idx_integration_state_name
      ON integration_state(name)
    `);

    // Settings table - application settings
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Activity log table - denormalized feed of commands/events/status/errors (chat excluded)
    db.exec(`
      CREATE TABLE activity_log (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        event TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX idx_activity_log_timestamp
      ON activity_log(timestamp)
    `);

    db.exec(`
      CREATE INDEX idx_activity_log_category_timestamp
      ON activity_log(category, timestamp)
    `);
  },
};
