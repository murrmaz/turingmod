import type {
  CommandContext,
  CommandResult,
  PermissionLevel,
  PlatformCapability,
} from '@turingmod/shared';

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

  /**
   * Validate if command can be executed
   * @param context - Execution context
   * @returns True if command can be executed
   */
  canExecute?(context: CommandContext): Promise<boolean>;
}
