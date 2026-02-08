import type { DatabaseManager } from '../DatabaseManager.js';
import type { Migration } from './MigrationRunner.js';

/**
 * Initial database schema
 * Creates all base tables for TuringMod
 */
export const initialSchema: Migration = {
  version: 1,
  name: 'initial_schema',

  up(db: DatabaseManager): void {
    // Users table - stores user information and permission levels
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        permission_level TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(platform, platform_user_id)
      )
    `);

    db.exec(`
      CREATE INDEX idx_users_platform_user_id
      ON users(platform, platform_user_id)
    `);

    // Command history table - audit log of executed commands
    db.exec(`
      CREATE TABLE command_history (
        id TEXT PRIMARY KEY,
        command_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        args TEXT,
        result TEXT,
        is_simulation INTEGER NOT NULL DEFAULT 0,
        executed_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE INDEX idx_command_history_executed_at
      ON command_history(executed_at)
    `);

    db.exec(`
      CREATE INDEX idx_command_history_user_id
      ON command_history(user_id)
    `);

    db.exec(`
      CREATE INDEX idx_command_history_is_simulation
      ON command_history(is_simulation)
    `);

    // Integration state table - integration configurations and state
    db.exec(`
      CREATE TABLE integration_state (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT,
        last_status TEXT NOT NULL,
        last_error TEXT,
        last_connected_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX idx_integration_state_name
      ON integration_state(name)
    `);

    // Settings table - application settings
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Encryption keys table - stores encryption key metadata
    db.exec(`
      CREATE TABLE encryption_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  },

  down(db: DatabaseManager): void {
    // Drop all tables in reverse order
    db.exec('DROP TABLE IF EXISTS encryption_keys');
    db.exec('DROP TABLE IF EXISTS settings');
    db.exec('DROP TABLE IF EXISTS integration_state');
    db.exec('DROP TABLE IF EXISTS command_history');

    db.exec('DROP TABLE IF EXISTS users');
  },
};
