import { singleton } from 'tsyringe';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';

/**
 * Migration interface
 */
export interface Migration {
  /** Migration version number */
  version: number;

  /** Migration name/description */
  name: string;

  /** Apply the migration */
  up(db: DatabaseManager): void;
}

/**
 * Migration runner
 * Manages database schema migrations
 */
@singleton()
export class MigrationRunner {
  constructor(
    private db: DatabaseManager,
    private logger: Logger
  ) {
    this.logger = logger.child({ component: 'MigrationRunner' });
  }

  /**
   * Initialize migrations table
   */
  private initializeMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Get applied migration versions
   */
  private getAppliedVersions(): number[] {
    const results = this.db.query<{ version: number }>(
      'SELECT version FROM migrations ORDER BY version'
    );
    return results.map((r) => r.version);
  }

  /**
   * Mark migration as applied
   */
  private markAsApplied(migration: Migration): void {
    this.db.run('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)', [
      migration.version,
      migration.name,
      Date.now(),
    ]);
  }

  /**
   * Run migrations
   */
  runMigrations(migrations: Migration[]): void {
    this.logger.info('Running database migrations');

    // Ensure migrations table exists
    this.initializeMigrationsTable();

    // Get applied versions
    const appliedVersions = new Set(this.getAppliedVersions());

    // Sort migrations by version
    const sortedMigrations = migrations.sort((a, b) => a.version - b.version);

    // Apply pending migrations
    for (const migration of sortedMigrations) {
      if (appliedVersions.has(migration.version)) {
        this.logger.debug(`Migration ${migration.version} already applied`, {
          name: migration.name,
        });
        continue;
      }

      this.logger.info(`Applying migration ${migration.version}`, {
        name: migration.name,
      });

      try {
        this.db.transaction(() => {
          migration.up(this.db);
          this.markAsApplied(migration);
        });

        this.logger.info(`Migration ${migration.version} applied successfully`, {
          name: migration.name,
        });
      } catch (error) {
        this.logger.error(`Migration ${migration.version} failed`, error, {
          name: migration.name,
        });
        throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error}`);
      }
    }

    this.logger.info('All migrations completed');
  }
}
