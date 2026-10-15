import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { ALL_MIGRATIONS } from './index.js';
import { MigrationRunner } from './MigrationRunner.js';

describe('drop_integration_status migration', () => {
  let dir: string;
  let db: DatabaseManager;
  let runner: MigrationRunner;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-migration-test-'));
    const logger = new Logger({ level: 'silent' });
    db = new DatabaseManager(join(dir, 'test.sqlite'), logger);
    await db.initialize();
    runner = new MigrationRunner(db, logger);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps existing integrations, with their config and enabled flag', () => {
    runner.runMigrations(ALL_MIGRATIONS.filter((m) => m.version < 4));
    db.run(
      `INSERT INTO integration_state
         (id, name, enabled, config, last_status, last_error, last_connected_at, created_at, updated_at)
       VALUES ('1', 'twitch-auth', 1, 'encrypted', 'error', 'boom', 5, 1, 2)`
    );

    runner.runMigrations([...ALL_MIGRATIONS]);

    expect(db.query('SELECT * FROM integration_state')).toEqual([
      {
        id: '1',
        name: 'twitch-auth',
        enabled: 1,
        config: 'encrypted',
        created_at: 1,
        updated_at: 2,
      },
    ]);
  });
});
