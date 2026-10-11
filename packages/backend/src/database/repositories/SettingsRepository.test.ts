import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { initialSchema } from '../migrations/001_initial_schema.js';
import { SettingsRepository } from './SettingsRepository.js';

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

  it('returns null for an unset key', async () => {
    expect(await repo.getJson('missing')).toBeNull();
  });

  it('round-trips a JSON value', async () => {
    await repo.setJson('breaks', { obs: { muteInputs: ['Mic/Aux'] } });
    expect(await repo.getJson('breaks')).toEqual({ obs: { muteInputs: ['Mic/Aux'] } });
  });

  it('replaces an existing value', async () => {
    await repo.setJson('breaks', { enabled: true });
    await repo.setJson('breaks', { enabled: false });
    expect(await repo.getJson('breaks')).toEqual({ enabled: false });
  });
});
