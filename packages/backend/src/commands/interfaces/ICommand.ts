import type {
  CommandResult,
  PermissionLevel,
  PlatformCapability,
  StreamingPlatform,
} from '@turingmod/shared';
import type { ParsedCommand } from '../parseCommand.js';

/**
 * Everything a command is run with: the command as parsed by `parseCommand()` (use `args` for
 * words, `argText` for free text), who ran it, and where.
 */
export interface CommandContext extends ParsedCommand {
  /** User executing the command */
  user: {
    id: string;
    platform: StreamingPlatform;
    platformUserId: string;
    username: string;
    permissionLevel: PermissionLevel;
  };

  /** Platform where command was executed */
  platform: StreamingPlatform;

  /** Whether this is a simulated command */
  isSimulation: boolean;
}

/**
 * Command interface
 * All commands must implement this interface
 */
export interface ICommand {
  /** Command name (without ! prefix) */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Usage example */
  readonly usage: string;

  /** Required permission levels */
  readonly permissions: PermissionLevel[];

  /** Cooldown in seconds (0 = no cooldown) */
  readonly cooldown: number;

  /** Platform capabilities this command requires. Empty = available on every platform. */
  readonly requiredCapabilities: PlatformCapability[];

  /**
   * Execute the command
   * @param context - Execution context
   * @returns Command result
   */
  execute(context: CommandContext): Promise<CommandResult>;
}
