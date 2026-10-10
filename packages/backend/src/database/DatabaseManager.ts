import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type SqlValue = SQLInputValue;

import type { Logger } from '../utils/Logger.js';

/**
 * Database Manager for node:sqlite
 * Manages SQLite database connection; every write commits durably to the file as it happens,
 * so there is no in-memory/on-disk divergence to flush or lose on crash.
 */
export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private logger: Logger;

  constructor(dbPath: string, logger: Logger) {
    this.dbPath = dbPath;
    this.logger = logger.child({ component: 'DatabaseManager' });
  }

  /**
   * Initialize the database
   * Opens the file if it exists, creates a new one if not
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing database', { path: this.dbPath });

    const isNew = !existsSync(this.dbPath);
    if (isNew) {
      this.logger.info('Creating new database');

      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    } else {
      this.logger.info('Loading existing database');
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');

    this.logger.info('Database initialized successfully');
  }

  /**
   * Get the database connection
   */
  getConnection(): DatabaseSync {
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
  }

  /**
   * Run a query and return results
   */
  query<T = unknown>(sql: string, params: SqlValue[] = []): T[] {
    const db = this.getConnection();
    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Run a query and return first result
   */
  queryOne<T = unknown>(sql: string, params: SqlValue[] = []): T | null {
    const db = this.getConnection();
    const stmt = db.prepare(sql);
    return (stmt.get(...params) as T | undefined) ?? null;
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const db = this.getConnection();
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);

    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
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
   * Close the database connection
   */
  close(): void {
    this.logger.info('Closing database');

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
