import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { ALL_MIGRATIONS } from '../migrations/index.js';
import { MigrationRunner } from '../migrations/MigrationRunner.js';

/** Test helper: a fully migrated database in a temp directory, and a way to remove it. */
export async function createTestDatabase(): Promise<{
  db: DatabaseManager;
  path: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'turingmod-test-db-'));
  const path = join(dir, 'test.sqlite');
  const logger = new Logger({ level: 'silent' });
  const db = new DatabaseManager(path, logger);
  await db.initialize();
  await new MigrationRunner(db, logger).runMigrations([...ALL_MIGRATIONS]);
  return {
    db,
    path,
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
