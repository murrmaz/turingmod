import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';

export type { SqlValue } from 'sql.js';

import type { Logger } from '../utils/Logger.js';

/**
 * Database Manager for sql.js
 * Manages SQLite database connection and persistence
 */
export class DatabaseManager {
  private db: Database | null = null;
  private dbPath: string;
  private logger: Logger;
  private saveInterval: NodeJS.Timeout | null = null;
  private isDirty = false;
  /** Chain all saves through this so the auto-save timer and close() never write concurrently. */
  private savePromise: Promise<void> = Promise.resolve();

  constructor(dbPath: string, logger: Logger) {
    this.dbPath = dbPath;
    this.logger = logger.child({ component: 'DatabaseManager' });
  }

  /**
   * Initialize the database
   * Loads from file if exists, creates new if not
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing database', { path: this.dbPath });

    const sql = await initSqlJs();

    // Check if database file exists
    if (existsSync(this.dbPath)) {
      // Load existing database
      this.logger.info('Loading existing database');
      const buffer = await readFile(this.dbPath);
      this.db = new sql.Database(buffer);
    } else {
      // Create new database
      this.logger.info('Creating new database');

      // Ensure directory exists
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      this.db = new sql.Database();

      // Save initial empty database
      await this.save();
    }

    // Start auto-save interval (every 5 seconds if dirty)
    this.startAutoSave();

    this.logger.info('Database initialized successfully');
  }

  /**
   * Get the database connection
   */
  getConnection(): Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute a SQL statement
   */
  exec(sql: string): void {
    const db = this.getConnection();
    db.exec(sql);
    this.isDirty = true;
  }

  /**
   * Run a query and return results
   */
  query<T = unknown>(sql: string, params: SqlValue[] = []): T[] {
    const db = this.getConnection();
    const stmt = db.prepare(sql);
    stmt.bind(params);

    const results: T[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row as T);
    }
    stmt.free();

    return results;
  }

  /**
   * Run a query and return first result
   */
  queryOne<T = unknown>(sql: string, params: SqlValue[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results[0] ?? null;
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const db = this.getConnection();
    db.run(sql, params);
    this.isDirty = true;

    // Get changes and last insert rowid
    const changes = db.getRowsModified();
    const lastInsertRowid =
      this.queryOne<{ id: number }>('SELECT last_insert_rowid() as id')?.id ?? 0;

    return { changes, lastInsertRowid };
  }

  /**
   * Begin a transaction
   */
  beginTransaction(): void {
    this.exec('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  commit(): void {
    this.exec('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  rollback(): void {
    this.exec('ROLLBACK');
  }

  /**
   * Execute a function within a transaction
   */
  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    this.beginTransaction();
    try {
      const result = await fn();
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  /**
   * Save database to file. Queued behind any in-flight save so concurrent callers (the
   * auto-save timer and close()) never write to dbPath at the same time.
   */
  save(): Promise<void> {
    const nextSave = this.savePromise.then(
      () => this.performSave(),
      () => this.performSave()
    );
    this.savePromise = nextSave;
    return nextSave;
  }

  private async performSave(): Promise<void> {
    if (!this.db) {
      return;
    }

    // Clear the flag before export/write (not after) so a mutation that lands while
    // writeFile() is in flight re-dirties the DB instead of being silently lost.
    this.isDirty = false;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await writeFile(this.dbPath, buffer);
      this.logger.debug('Database saved to disk');
    } catch (error) {
      this.isDirty = true;
      this.logger.error('Failed to save database', error);
      throw error;
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    this.saveInterval = setInterval(async () => {
      if (this.isDirty) {
        try {
          await this.save();
        } catch (error) {
          this.logger.error('Auto-save failed', error);
        }
      }
    }, 5000); // Save every 5 seconds if dirty
  }

  /**
   * Stop auto-save interval
   */
  private stopAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.logger.info('Closing database');

    // Stop auto-save
    this.stopAutoSave();

    // Final save
    if (this.isDirty) {
      await this.save();
    }

    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.logger.info('Database closed');
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }
}
