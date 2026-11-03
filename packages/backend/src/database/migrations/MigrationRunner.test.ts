import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { type Migration, MigrationRunner } from './MigrationRunner.js';

function createTable(version: number): Migration {
  return {
    version,
    name: `table_${version}`,
    up(db) {
      db.exec(`CREATE TABLE table_${version} (id INTEGER PRIMARY KEY)`);
    },
  };
}

describe('MigrationRunner', () => {
  let dir: string;
  let db: DatabaseManager;
  let runner: MigrationRunner;

  const appliedVersions = () =>
    db.query<{ version: number }>('SELECT version FROM migrations').map((row) => row.version);

  const tableNames = () =>
    db
      .query<{ name: string }>("SELECT name FROM sqlite_master WHERE name LIKE 'table_%'")
      .map((row) => row.name);

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

  it('applies only the migrations not yet applied, keeping existing data', () => {
    runner.runMigrations([createTable(1)]);
    db.run('INSERT INTO table_1 (id) VALUES (7)');

    runner.runMigrations([createTable(1), createTable(2)]);

    expect(appliedVersions()).toEqual([1, 2]);
    expect(db.query('SELECT id FROM table_1')).toEqual([{ id: 7 }]);
    expect(tableNames()).toContain('table_2');
  });

  it('applies migrations in version order, whatever order they are given in', () => {
    const order: number[] = [];
    const recording = (version: number): Migration => ({
      version,
      name: `step_${version}`,
      up() {
        order.push(version);
      },
    });

    runner.runMigrations([recording(2), recording(1)]);

    expect(order).toEqual([1, 2]);
  });

  it('rolls back a migration that fails, and does not record it', () => {
    const failing: Migration = {
      version: 1,
      name: 'failing',
      up(database) {
        database.exec('CREATE TABLE table_partial (id INTEGER PRIMARY KEY)');
        throw new Error('boom');
      },
    };

    expect(() => runner.runMigrations([failing])).toThrow('Migration 1 (failing) failed');

    expect(appliedVersions()).toEqual([]);
    expect(tableNames()).toEqual([]);
  });
});
