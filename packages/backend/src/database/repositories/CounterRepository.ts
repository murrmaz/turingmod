import { injectable, singleton } from 'tsyringe';
import { DatabaseManager } from '../DatabaseManager.js';

/** Names of the counters the original bot kept. */
export const COUNTERS = {
  deaths: 'deaths',
  voiceCracks: 'voice_cracks',
} as const;

/** Named running counts, such as the death counter. A counter that was never set reads as 0. */
@injectable()
@singleton()
export class CounterRepository {
  constructor(private db: DatabaseManager) {}

  get(name: string): Promise<number> {
    return Promise.resolve(this.find(name) ?? 0);
  }

  /** Whether the counter has ever been set. */
  has(name: string): Promise<boolean> {
    return Promise.resolve(this.find(name) !== null);
  }

  /** Add `by` (default 1) and resolve to the new value, in one statement so counts never race. */
  increment(name: string, by = 1): Promise<number> {
    const row = this.db.queryOne<{ value: number }>(
      `INSERT INTO counters (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = value + excluded.value,
         updated_at = excluded.updated_at
       RETURNING value`,
      [name, by, Date.now()]
    );
    return Promise.resolve(row?.value ?? by);
  }

  set(name: string, value: number): Promise<void> {
    this.db.run(
      `INSERT INTO counters (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [name, value, Date.now()]
    );
    return Promise.resolve();
  }

  private find(name: string): number | null {
    return (
      this.db.queryOne<{ value: number }>('SELECT value FROM counters WHERE name = ?', [name])
        ?.value ?? null
    );
  }
}
