import type { PermissionLevel } from '../constants/permissions.js';

/**
 * Command metadata exposed to clients
 * Derived from code-defined commands at runtime
 */
export interface CommandInfo {
  /** Command name (without ! prefix) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Usage examples */
  usage: string;

  /** Required permission levels */
  permissions: PermissionLevel[];

  /** Cooldown in seconds (0 = no cooldown) */
  cooldown: number;
}

/**
 * Context passed to command during execution
 */
export interface CommandContext {
  /** User executing the command */
  user: {
    id: string;
    platform: string;
    platformUserId: string;
    username: string;
    permissionLevel: PermissionLevel;
  };

  /** Command arguments (parsed from command text) */
  args: string[];

  /** Platform where command was executed */
  platform: string;

  /** Additional platform-specific metadata */
  metadata: Record<string, unknown>;

  /** Whether this is a simulated command */
  isSimulation: boolean;
}

/**
 * Result of command execution
 */
export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;

  /** Message to send back to user/chat */
  message: string;

  /** Optional data returned by the command */
  data?: Record<string, unknown>;

  /** Error details if command failed */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Command history entry for audit log
 */
export interface CommandHistoryEntry {
  /** Unique identifier */
  id: string;

  /** Command name */
  commandName: string;

  /** User who executed the command */
  userId: string;

  /** Platform where command was executed */
  platform: string;

  /** Command arguments */
  args: string[];

  /** Command result */
  result: CommandResult;

  /** Whether this was a simulated execution */
  isSimulation: boolean;

  /** Timestamp when command was executed */
  executedAt: number;
}
