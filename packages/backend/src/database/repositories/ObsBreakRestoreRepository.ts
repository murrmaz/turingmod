import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ObsBreakSnapshot } from '../../breaks/ObsBreakOverlay.js';
import { DatabaseManager } from '../DatabaseManager.js';

/** A snapshot as stored: its maps as arrays of entries. */
const StoredSnapshotSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      key: z.string().min(1),
      sceneUuid: z.string().min(1),
      sceneItemId: z.number().int(),
      enabled: z.boolean(),
    })
  ),
  inputs: z.array(z.strictObject({ inputName: z.string().min(1), muted: z.boolean() })),
});

/**
 * The OBS state a break still owes back (`ObsBreakSnapshot`): saved when a break changes OBS,
 * cleared once it has been restored. It outlives TuringMod, so a break interrupted by a crash or
 * by OBS being unreachable is undone the next time OBS connects.
 */
@singleton()
export class ObsBreakRestoreRepository {
  constructor(private db: DatabaseManager) {}

  /** The stored snapshot, or null if nothing is owed. Throws if what's stored isn't valid. */
  get(): ObsBreakSnapshot | null {
    const row = this.db.queryOne<{ snapshot: string }>(
      'SELECT snapshot FROM obs_break_restore WHERE id = 1'
    );
    if (!row) {
      return null;
    }
    const stored = StoredSnapshotSchema.parse(JSON.parse(row.snapshot));
    return {
      items: new Map(stored.items.map(({ key, ...item }) => [key, item])),
      inputs: new Map(stored.inputs.map(({ inputName, muted }) => [inputName, muted])),
    };
  }

  save(snapshot: ObsBreakSnapshot): void {
    const stored: z.infer<typeof StoredSnapshotSchema> = {
      items: [...snapshot.items].map(([key, item]) => ({ key, ...item })),
      inputs: [...snapshot.inputs].map(([inputName, muted]) => ({ inputName, muted })),
    };
    this.db.run(
      `INSERT INTO obs_break_restore (id, snapshot, saved_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, saved_at = excluded.saved_at`,
      [JSON.stringify(stored), Date.now()]
    );
  }

  clear(): void {
    this.db.run('DELETE FROM obs_break_restore');
  }
}
