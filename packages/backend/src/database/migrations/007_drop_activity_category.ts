import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * Drop `activity_log.category`. An entry's category follows from its event
 * (ACTIVITY_EVENT_CATEGORIES in shared), so a stored copy could only ever disagree with it. SQLite
 * won't drop an indexed column, so its index goes first.
 */
export const dropActivityCategory: Migration = {
  version: 7,
  name: 'drop_activity_category',

  up(db: DatabaseManager): void {
    db.exec('DROP INDEX idx_activity_log_category_timestamp');
    db.exec('ALTER TABLE activity_log DROP COLUMN category');
  },
};
