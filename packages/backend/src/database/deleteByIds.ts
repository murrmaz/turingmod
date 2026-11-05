import type { DatabaseManager } from './DatabaseManager.js';

/**
 * Delete the rows of `table` with these ids; ones already gone are skipped. Returns how many went.
 * `table` is written into the SQL, so it must be a repository's own constant, never input.
 */
export function deleteByIds(db: DatabaseManager, table: string, ids: readonly number[]): number {
  if (ids.length === 0) {
    return 0; // `IN ()` isn't valid SQL
  }
  const placeholders = ids.map(() => '?').join(', ');
  return db.run(`DELETE FROM ${table} WHERE id IN (${placeholders})`, [...ids]).changes;
}
