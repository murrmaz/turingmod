import type { CommandHistoryEntry } from '@turingmod/shared';
import type { DatabaseManager, SqlValue } from '../DatabaseManager.js';

/**
 * Database row structure for command_history table
 */
interface CommandHistoryRow {
  id: string;
  command_name: string;
  user_id: string;
  platform: string;
  args: string; // JSON array
  result: string; // JSON object
  is_simulation: number; // SQLite boolean (0 or 1)
  executed_at: number;
}

/**
 * Command history repository
 * Manages command execution audit log
 */
export class CommandHistoryRepository {
  constructor(private db: DatabaseManager) {}

  /**
   * Convert database row to CommandHistoryEntry entity
   */
  private rowToEntity(row: CommandHistoryRow): CommandHistoryEntry {
    return {
      id: row.id,
      commandName: row.command_name,
      userId: row.user_id,
      platform: row.platform,
      args: JSON.parse(row.args),
      result: JSON.parse(row.result),
      isSimulation: row.is_simulation === 1,
      executedAt: row.executed_at,
    };
  }

  /**
   * Create a command history entry
   */
  create(entry: Omit<CommandHistoryEntry, 'id'>): Promise<CommandHistoryEntry> {
    const id = crypto.randomUUID();

    this.db.run(
      `INSERT INTO command_history (
        id, command_name, user_id, platform, args, result,
        is_simulation, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.commandName,
        entry.userId,
        entry.platform,
        JSON.stringify(entry.args),
        JSON.stringify(entry.result),
        entry.isSimulation ? 1 : 0,
        entry.executedAt,
      ]
    );

    return Promise.resolve({ id, ...entry });
  }

  /**
   * Find history entries by user
   */
  async findByUserId(userId: string, limit = 50): Promise<CommandHistoryEntry[]> {
    const rows = this.db.query<CommandHistoryRow>(
      `SELECT * FROM command_history
       WHERE user_id = ?
       ORDER BY executed_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Find history entries by command name
   */
  async findByCommandName(commandName: string, limit = 50): Promise<CommandHistoryEntry[]> {
    const rows = this.db.query<CommandHistoryRow>(
      `SELECT * FROM command_history
       WHERE command_name = ?
       ORDER BY executed_at DESC
       LIMIT ?`,
      [commandName, limit]
    );
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Find recent history entries
   */
  async findRecent(limit = 50, includeSimulations = true): Promise<CommandHistoryEntry[]> {
    let sql = 'SELECT * FROM command_history';
    const params: SqlValue[] = [];

    if (!includeSimulations) {
      sql += ' WHERE is_simulation = 0';
    }

    sql += ' ORDER BY executed_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.query<CommandHistoryRow>(sql, params);
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Delete old history entries
   */
  deleteOlderThan(timestamp: number): Promise<number> {
    const result = this.db.run('DELETE FROM command_history WHERE executed_at < ?', [timestamp]);
    return Promise.resolve(result.changes);
  }
}
