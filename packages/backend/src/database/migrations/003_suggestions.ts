import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/** Viewers' suggestions for the bot, collected with `!sg`. */
export const suggestions: Migration = {
  version: 3,
  name: 'suggestions',

  up(db: DatabaseManager): void {
    db.exec(`
      CREATE TABLE suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        suggestion TEXT NOT NULL,
        suggested_by TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  },
};
