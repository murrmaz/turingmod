import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * Drop the status columns from `integration_state`. They were written on every status change and
 * never read: the console gets status live from the integrations, and boot starts what is enabled
 * whatever it last reported.
 */
export const dropIntegrationStatus: Migration = {
  version: 4,
  name: 'drop_integration_status',

  up(db: DatabaseManager): void {
    db.exec('ALTER TABLE integration_state DROP COLUMN last_status');
    db.exec('ALTER TABLE integration_state DROP COLUMN last_error');
    db.exec('ALTER TABLE integration_state DROP COLUMN last_connected_at');
  },
};
