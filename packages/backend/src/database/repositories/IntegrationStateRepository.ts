import type { IntegrationConfig } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
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

/**
 * Integration state repository
 * Manages integration configurations with encrypted storage
 */
@injectable()
@singleton()
export class IntegrationStateRepository {
  constructor(
    private db: DatabaseManager,
    private encryption: Encryption
  ) {}

  /**
   * Convert database row to IntegrationConfig entity
   */
  private rowToEntity(row: IntegrationStateRow): IntegrationConfig {
    const entity: IntegrationConfig = {
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
  findByName(name: string): IntegrationConfig | null {
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
  findAll(): IntegrationConfig[] {
    const rows = this.db.query<IntegrationStateRow>(
      'SELECT * FROM integration_state ORDER BY name'
    );
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Find all enabled integrations
   */
  findAllEnabled(): IntegrationConfig[] {
    const rows = this.db.query<IntegrationStateRow>(
      'SELECT * FROM integration_state WHERE enabled = 1 ORDER BY name'
    );
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Create or update integration config
   */
  upsert(name: string, config: Record<string, unknown>, enabled: boolean): IntegrationConfig {
    const existing = this.findByName(name);
    const now = Date.now();

    // Encrypt configuration
    const encryptedConfig = this.encryption.encryptObject(config);

    if (existing) {
      // Update
      this.db.run(
        `UPDATE integration_state
         SET config = ?, enabled = ?, updated_at = ?
         WHERE name = ?`,
        [encryptedConfig, enabled ? 1 : 0, now, name]
      );
      const updated = this.findByName(name);
      if (!updated) throw new Error(`Integration state not found after update: ${name}`);
      return updated;
    }
    // Create
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO integration_state (
          id, name, enabled, config, last_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, enabled ? 1 : 0, encryptedConfig, IntegrationStatus.DISCONNECTED, now, now]
    );
    const created = this.findByName(name);
    if (!created) throw new Error(`Integration state not found after insert: ${name}`);
    return created;
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

  /**
   * Update integration enabled flag
   */
  updateEnabled(name: string, enabled: boolean): void {
    const now = Date.now();

    this.db.run(
      `UPDATE integration_state
       SET enabled = ?, updated_at = ?
       WHERE name = ?`,
      [enabled ? 1 : 0, now, name]
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
      throw new Error(`Failed to decrypt configuration for ${name}: ${error}`);
    }
  }
}
