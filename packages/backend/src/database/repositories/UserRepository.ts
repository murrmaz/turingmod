import type { PermissionLevel, User } from '@turingmod/shared';
import type { DatabaseManager, SqlValue } from '../DatabaseManager.js';
import type { IRepository } from '../interfaces/IRepository.js';

/**
 * Database row structure for users table
 */
interface UserRow {
  id: string;
  platform: string;
  platform_user_id: string;
  username: string;
  permission_level: PermissionLevel;
  created_at: number;
  updated_at: number;
}

/**
 * User repository
 * Manages user data persistence
 */
export class UserRepository implements IRepository<User> {
  constructor(private db: DatabaseManager) {}

  /**
   * Convert database row to User entity
   */
  private rowToEntity(row: UserRow): User {
    return {
      id: row.id,
      platform: row.platform,
      platformUserId: row.platform_user_id,
      username: row.username,
      permissionLevel: row.permission_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Find user by ID
   */
  findById(id: string): Promise<User | null> {
    const row = this.db.queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    if (row) {
      return Promise.resolve(this.rowToEntity(row));
    }
    return Promise.resolve(null);
  }

  /**
   * Find user by platform and platform user ID
   */
  findByPlatformUserId(platform: string, platformUserId: string): Promise<User | null> {
    const row = this.db.queryOne<UserRow>(
      'SELECT * FROM users WHERE platform = ? AND platform_user_id = ?',
      [platform, platformUserId]
    );
    if (row) {
      return Promise.resolve(this.rowToEntity(row));
    }
    return Promise.resolve(null);
  }

  /**
   * Find all users
   */
  async findAll(filter?: Partial<User>): Promise<User[]> {
    let sql = 'SELECT * FROM users';
    const params: SqlValue[] = [];

    if (filter) {
      const conditions: string[] = [];
      if (filter.platform) {
        conditions.push('platform = ?');
        params.push(filter.platform);
      }
      if (filter.permissionLevel) {
        conditions.push('permission_level = ?');
        params.push(filter.permissionLevel);
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }
    }

    const rows = this.db.query<UserRow>(sql, params);
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Create a new user
   */
  create(entity: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.run(
      `INSERT INTO users (
        id, platform, platform_user_id, username, permission_level,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entity.platform,
        entity.platformUserId,
        entity.username,
        entity.permissionLevel,
        now,
        now,
      ]
    );

    return Promise.resolve({
      id,
      ...entity,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Update an existing user
   */
  async update(id: string, entity: Partial<User>): Promise<User> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`User not found: ${id}`);
    }

    const now = Date.now();
    const updates: string[] = [];
    const params: SqlValue[] = [];

    if (entity.username !== undefined) {
      updates.push('username = ?');
      params.push(entity.username);
    }
    if (entity.permissionLevel !== undefined) {
      updates.push('permission_level = ?');
      params.push(entity.permissionLevel);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      this.db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await this.findById(id);
    if (!updated) throw new Error(`User not found after update: ${id}`);
    return updated;
  }

  /**
   * Delete a user
   */
  delete(id: string): Promise<boolean> {
    const result = this.db.run('DELETE FROM users WHERE id = ?', [id]);
    return Promise.resolve(result.changes > 0);
  }
}
