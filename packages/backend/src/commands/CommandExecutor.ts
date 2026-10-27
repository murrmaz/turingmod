import type { ExecutionResult, ExecutorErrorCode } from '@turingmod/shared';
import { hasPermission, messageOf, PermissionLevel } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { Logger } from '../utils/Logger.js';
import { CommandAvailability } from './CommandAvailability.js';
import type { CommandContext, ICommand } from './interfaces/ICommand.js';

/**
 * Cooldown tracker
 */
interface CooldownEntry {
  userId: string;
  commandName: string;
  expiresAt: number;
}

/**
 * Command executor
 * Handles command execution with permission checks and cooldowns
 */
@singleton()
export class CommandExecutor {
  private cooldowns = new Map<string, CooldownEntry>();
  private logger: Logger;

  constructor(
    private availability: CommandAvailability,
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'CommandExecutor' });
  }

  /**
   * Execute a command
   */
  async execute(context: CommandContext): Promise<ExecutionResult> {
    const { user, command: commandName } = context;

    this.logger.debug(`Executing command: ${commandName}`, {
      user: user.username,
      platform: context.platform,
      isSimulation: context.isSimulation,
    });

    // A command the origin platform doesn't offer gets the same COMMAND_NOT_FOUND as an unknown
    // one (design decision: hidden == unknown on that platform).
    const command = this.availability.find(commandName, context.platform);
    if (!command) {
      const result = rejected(
        'COMMAND_NOT_FOUND',
        `Unknown command: ${commandName}`,
        `Command '${commandName}' does not exist`
      );
      await this.logExecution(commandName, context, result);
      return result;
    }

    // Check permissions
    const hasRequiredPermission = command.permissions.some((required) =>
      hasPermission(user.permissionLevel, required)
    );

    if (!hasRequiredPermission) {
      const result = rejected(
        'INSUFFICIENT_PERMISSIONS',
        `Insufficient permissions for command: ${commandName}`,
        `Required permissions: ${command.permissions.join(', ')}`
      );
      await this.logExecution(commandName, context, result);
      return result;
    }

    // Check cooldown
    if (this.cooldownApplies(command, context)) {
      const cooldownKey = `${user.id}:${commandName}`;
      const cooldownEntry = this.cooldowns.get(cooldownKey);

      if (cooldownEntry && cooldownEntry.expiresAt > Date.now()) {
        const remainingSeconds = Math.ceil((cooldownEntry.expiresAt - Date.now()) / 1000);
        const result = rejected(
          'COMMAND_ON_COOLDOWN',
          `Command on cooldown. Try again in ${remainingSeconds}s`,
          `Cooldown expires in ${remainingSeconds} seconds`
        );
        await this.logExecution(commandName, context, result);
        return result;
      }

      // Started before the command runs, not after it finishes: chat is handled concurrently, so
      // a burst of the same command arrives while the first is still waiting on its API call, and
      // would otherwise all pass the check above. It stays set if the command fails or crashes,
      // since retrying a failing call costs the same request.
      this.cleanupCooldowns();
      this.cooldowns.set(cooldownKey, {
        userId: user.id,
        commandName,
        expiresAt: Date.now() + command.cooldown * 1000,
      });
    }

    // Execute command
    try {
      const result = await command.execute(context);

      // Log successful execution
      await this.logExecution(commandName, context, result);

      this.logger.info(`Command executed successfully: ${commandName}`, {
        user: user.username,
        success: result.success,
      });

      return result;
    } catch (error) {
      this.logger.error(`Command execution failed: ${commandName}`, error, {
        user: user.username,
      });

      const result = rejected('EXECUTION_ERROR', 'Command execution failed', messageOf(error));

      await this.logExecution(commandName, context, result);
      return result;
    }
  }

  /**
   * Publish the run as `command.executed`, which the activity log records.
   */
  private async logExecution(
    commandName: string,
    context: CommandContext,
    result: ExecutionResult
  ): Promise<void> {
    try {
      await this.eventBus.emit('command.executed', {
        command: commandName,
        username: context.user.username,
        userId: context.user.id,
        platform: context.platform,
        args: context.args,
        success: result.success,
        message: result.message,
        errorCode: result.success ? undefined : result.error.code,
        reason: result.success ? undefined : result.error.reason,
        isSimulation: context.isSimulation,
      });
    } catch (error) {
      this.logger.error('Failed to log command execution', error);
    }
  }

  /**
   * Whether `command`'s cooldown applies to this invocation.
   *
   * Moderators and above are exempt. Cooldowns exist to stop a viewer spamming the API-backed
   * read commands, and several of those expose a moderator-only write branch under the same
   * name (!game, !tags, !cw) — a shared cooldown would block a mod correcting a typo.
   */
  private cooldownApplies(command: ICommand, context: CommandContext): boolean {
    if (context.isSimulation || command.cooldown <= 0) {
      return false;
    }
    return !hasPermission(context.user.permissionLevel, PermissionLevel.MODERATOR);
  }

  /**
   * Clean up expired cooldowns
   */
  private cleanupCooldowns(): void {
    const now = Date.now();
    for (const [key, entry] of this.cooldowns.entries()) {
      if (entry.expiresAt <= now) {
        this.cooldowns.delete(key);
      }
    }
  }
}

/** A run the executor refused or that crashed, as opposed to a failure the command reported. */
function rejected(code: ExecutorErrorCode, message: string, reason: string): ExecutionResult {
  return { success: false, message, error: { code, reason } };
}
