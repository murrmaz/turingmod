import { injectable, singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

/**
 * Key/value store over the `settings` table for app-level settings that don't belong to any one
 * integration (e.g. stream-break behavior). Values are stored as JSON and are not encrypted, so
 * nothing secret goes here — credentials belong in integration config.
 */
@injectable()
@singleton()
export class SettingsRepository {
  constructor(private db: DatabaseManager) {}

  /** The parsed JSON value for `key`, or null if unset. Throws if the stored value isn't JSON. */
  getJson(key: string): unknown {
    const row = this.db.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      key,
    ]);
    return row ? (JSON.parse(row.value) as unknown) : null;
  }

  /** Store `value` as JSON under `key`, replacing any existing value. */
  setJson(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), Date.now()]
    );
  }
}
