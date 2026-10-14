import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { Encryption } from '../../utils/Encryption.js';
import { DatabaseManager } from '../DatabaseManager.js';

/**
 * Database row structure for integration_state table
 */
interface IntegrationStateRow {
  id: string;
  name: string;
  enabled: number; // SQLite boolean
  config: string | null; // Encrypted JSON
  last_status: IntegrationStatus;
  last_error: string | null;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
}

/** An integration's saved state, as read from `integration_state`. */
export interface IntegrationState {
  id: string;
  name: string;
  /** Whether the streamer wants it running: set by starting or stopping it from the console. */
  enabled: boolean;
  /** Encrypted configuration (JSON); empty if none has been saved. */
  config: string;
  lastStatus: IntegrationStatus;
  lastError?: string;
  lastConnectedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Integration state repository
 * Manages integration configurations with encrypted storage
 */
@singleton()
export class IntegrationStateRepository {
  constructor(
    private db: DatabaseManager,
    private encryption: Encryption
  ) {}

  /**
   * Convert database row to IntegrationState entity
   */
  private rowToEntity(row: IntegrationStateRow): IntegrationState {
    const entity: IntegrationState = {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      config: row.config || '',
      lastStatus: row.last_status as IntegrationStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.last_error !== null) {
      entity.lastError = row.last_error;
    }

    if (row.last_connected_at !== null) {
      entity.lastConnectedAt = row.last_connected_at;
    }

    return entity;
  }

  /**
   * Find integration config by name
   */
  findByName(name: string): IntegrationState | null {
    const row = this.db.queryOne<IntegrationStateRow>(
      'SELECT * FROM integration_state WHERE name = ?',
      [name]
    );
    if (row) {
      return this.rowToEntity(row);
    }
    return null;
  }

  /**
   * Find all integration configs
   */
  findAll(): IntegrationState[] {
    const rows = this.db.query<IntegrationStateRow>(
      'SELECT * FROM integration_state ORDER BY name'
    );
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Find all enabled integrations
   */
  findAllEnabled(): IntegrationState[] {
    const rows = this.db.query<IntegrationStateRow>(
      'SELECT * FROM integration_state WHERE enabled = 1 ORDER BY name'
    );
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Store an integration's config, encrypted, leaving whether it is enabled as it was. An
   * integration seen for the first time starts out disabled.
   */
  saveConfig(name: string, config: Record<string, unknown>): void {
    this.ensureRow(name);
    this.db.run('UPDATE integration_state SET config = ?, updated_at = ? WHERE name = ?', [
      this.encryption.encryptObject(config),
      Date.now(),
      name,
    ]);
  }

  /** Record whether the streamer wants an integration running, whether or not it has a config. */
  setEnabled(name: string, enabled: boolean): void {
    this.ensureRow(name);
    this.db.run('UPDATE integration_state SET enabled = ?, updated_at = ? WHERE name = ?', [
      enabled ? 1 : 0,
      Date.now(),
      name,
    ]);
  }

  /**
   * Update integration status
   */
  updateStatus(name: string, status: IntegrationStatus, error?: string): void {
    const now = Date.now();
    const connectedAt = status === IntegrationStatus.CONNECTED ? now : null;

    this.db.run(
      `UPDATE integration_state
       SET last_status = ?, last_error = ?, last_connected_at = ?, updated_at = ?
       WHERE name = ?`,
      [status, error ?? null, connectedAt, now, name]
    );
  }

  /** Create a disabled, unconfigured row for `name` if it has none. */
  private ensureRow(name: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO integration_state (id, name, enabled, config, last_status, created_at, updated_at)
       VALUES (?, ?, 0, NULL, ?, ?, ?)
       ON CONFLICT(name) DO NOTHING`,
      [crypto.randomUUID(), name, IntegrationStatus.DISCONNECTED, now, now]
    );
  }

  /**
   * Get decrypted configuration
   */
  getDecryptedConfig(name: string): Record<string, unknown> | null {
    const config = this.findByName(name);
    if (!config?.config) {
      return null;
    }

    try {
      return this.encryption.decryptObject<Record<string, unknown>>(config.config);
    } catch (error) {
      // AES-GCM fails authentication rather than decrypting to garbage, so this is almost always
      // a different key from the one the config was saved with.
      throw new Error(
        `Could not decrypt the stored configuration for ${name} (${messageOf(error)}). ` +
          'It was most likely saved with a different MASTER_PASSWORD; until MASTER_PASSWORD was ' +
          'required, TuringMod used a built-in default. Set it up again from the console, or ' +
          'restore the MASTER_PASSWORD it was saved with.'
      );
    }
  }
}
