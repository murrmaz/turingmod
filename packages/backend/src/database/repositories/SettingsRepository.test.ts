import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { initialSchema } from '../migrations/001_initial_schema.js';
import { type SettingsDefinition, SettingsRepository } from './SettingsRepository.js';

const TEST_SETTINGS: SettingsDefinition<{ enabled: boolean; sources: string[] }> = {
  key: 'test',
  schema: z.strictObject({
    enabled: z.boolean().default(true),
    sources: z.array(z.string().min(1)).default(() => []),
  }),
};

describe('SettingsRepository', () => {
  let dir: string;
  let db: DatabaseManager;
  let repo: SettingsRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-settings-repo-test-'));
    db = new DatabaseManager(join(dir, 'test.sqlite'), new Logger({ level: 'silent' }));
    await db.initialize();
    initialSchema.up(db);
    repo = new SettingsRepository(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the defaults when nothing is stored', () => {
    expect(repo.get(TEST_SETTINGS)).toEqual({ enabled: true, sources: [] });
  });

  it('round-trips settings', () => {
    repo.set(TEST_SETTINGS, { enabled: false, sources: ['Cam'] });
    expect(repo.get(TEST_SETTINGS)).toEqual({ enabled: false, sources: ['Cam'] });
  });

  it('replaces an existing value', () => {
    repo.set(TEST_SETTINGS, { enabled: true, sources: [] });
    repo.set(TEST_SETTINGS, { enabled: false, sources: [] });
    expect(repo.get(TEST_SETTINGS).enabled).toBe(false);
  });

  it('throws, naming the field, when the stored value does not fit the schema', () => {
    db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
      'test',
      JSON.stringify({ enabled: 'yes' }),
      0,
    ]);
    expect(() => repo.get(TEST_SETTINGS)).toThrow(/Invalid "test" settings[\s\S]*enabled/);
  });

  it('throws when the stored value is not JSON', () => {
    db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['test', '{', 0]);
    expect(() => repo.get(TEST_SETTINGS)).toThrow(/not valid JSON/);
  });

  it('refuses to store settings that do not fit the schema', () => {
    expect(() => repo.set(TEST_SETTINGS, { enabled: true, sources: [''] })).toThrow();
    expect(repo.get(TEST_SETTINGS)).toEqual({ enabled: true, sources: [] });
  });
});
