import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { ALL_MIGRATIONS } from './index.js';
import { MigrationRunner } from './MigrationRunner.js';

describe('drop_activity_category migration', () => {
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

  it('keeps existing entries, without their category', () => {
    runner.runMigrations(ALL_MIGRATIONS.filter((m) => m.version < 7));
    db.run(
      `INSERT INTO activity_log (id, category, event, data, timestamp)
       VALUES ('1', 'event', 'twitch.follow', '{}', 5)`
    );

    runner.runMigrations([...ALL_MIGRATIONS]);

    expect(db.query('SELECT * FROM activity_log')).toEqual([
      { id: '1', event: 'twitch.follow', data: '{}', timestamp: 5 },
    ]);
  });
});
