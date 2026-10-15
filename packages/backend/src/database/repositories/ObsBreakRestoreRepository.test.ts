import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ObsBreakSnapshot } from '../../breaks/ObsBreakOverlay.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { ObsBreakRestoreRepository } from './ObsBreakRestoreRepository.js';
import { createTestDatabase } from './testDatabase.js';

describe('ObsBreakRestoreRepository', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let repo: ObsBreakRestoreRepository;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    repo = new ObsBreakRestoreRepository(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  const snapshot = (): ObsBreakSnapshot => ({
    items: new Map([
      ['scene:1', { sceneUuid: 'scene', sceneItemId: 1, enabled: true }],
      ['group:4', { sceneUuid: 'group', sceneItemId: 4, enabled: false }],
    ]),
    inputs: new Map([['Mic/Aux', false]]),
  });

  it('holds nothing until something is saved', () => {
    expect(repo.get()).toBeNull();
  });

  it('round-trips a snapshot, and replaces it on the next save', () => {
    repo.save(snapshot());
    expect(repo.get()).toEqual(snapshot());

    const next = snapshot();
    next.inputs.set('Desktop Audio', true);
    repo.save(next);
    expect(repo.get()).toEqual(next);
  });

  it('holds nothing once cleared', () => {
    repo.save(snapshot());
    repo.clear();

    expect(repo.get()).toBeNull();
  });

  it('refuses a stored snapshot that does not fit', () => {
    db.run('INSERT INTO obs_break_restore (id, snapshot, saved_at) VALUES (1, ?, 0)', [
      JSON.stringify({ items: [{ key: 'scene:1' }], inputs: [] }),
    ]);

    expect(() => repo.get()).toThrow();
  });
});
