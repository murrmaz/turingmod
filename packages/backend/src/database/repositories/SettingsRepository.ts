import { singleton } from 'tsyringe';
import { z } from 'zod';
import { DatabaseManager } from '../DatabaseManager.js';

/**
 * One group of settings: the key it is stored under, and the schema the stored value must match.
 * The schema's defaults are the settings when nothing is stored.
 */
export interface SettingsDefinition<T> {
  readonly key: string;
  readonly schema: z.ZodType<T>;
}

/**
 * Key/value store over the `settings` table for app-level settings that don't belong to any one
 * integration (e.g. stream-break behavior). Values are stored as JSON and are not encrypted, so
 * nothing secret goes here — credentials belong in integration config.
 *
 * Settings are read through their definition, so a stored value is checked against its schema
 * every time it is read, and one that doesn't fit is an error rather than something to work
 * around: get() throws, naming every field that was wrong.
 */
@singleton()
export class SettingsRepository {
  constructor(private db: DatabaseManager) {}

  /** The stored settings, parsed; the schema's defaults when nothing is stored. */
  get<T>(definition: SettingsDefinition<T>): T {
    const row = this.db.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      definition.key,
    ]);
    let stored: unknown = {};
    if (row) {
      try {
        stored = JSON.parse(row.value);
      } catch (error) {
        throw new Error(`The "${definition.key}" settings are not valid JSON`, { cause: error });
      }
    }
    const result = definition.schema.safeParse(stored);
    if (!result.success) {
      throw new Error(`Invalid "${definition.key}" settings:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
  }

  /** Store settings, replacing any existing value. */
  set<T>(definition: SettingsDefinition<T>, value: T): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [definition.key, JSON.stringify(definition.schema.parse(value)), Date.now()]
    );
  }
}
