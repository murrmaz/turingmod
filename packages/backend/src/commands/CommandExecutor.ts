import type { CommandContext, CommandResult } from '@turingmod/shared';
import { hasPermission } from '@turingmod/shared';
import type { EventBus } from '../core/EventBus.js';
import type { CommandHistoryRepository } from '../database/repositories/CommandHistoryRepository.js';
import type { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import type { Logger } from '../utils/Logger.js';
import type { CommandRegistry } from './CommandRegistry.js';

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
export class CommandExecutor {
  private cooldowns = new Map<string, CooldownEntry>();
  private logger: Logger;

  constructor(
    private registry: CommandRegistry,
    private historyRepository: CommandHistoryRepository,
    private platformRegistry: PlatformRegistry,
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'CommandExecutor' });
  }

  /**
   * Execute a command
   */
  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, args } = context;

    // Parse command name from first arg or extract from metadata
    const commandName = args[0]?.replace(/^!/, '') || '';

    this.logger.debug(`Executing command: ${commandName}`, {
      user: user.username,
      platform: context.platform,
      isSimulation: context.isSimulation,
    });

    // Get command. A command that exists but whose requiredCapabilities are not satisfied by the
    // origin platform is treated as hidden — it returns the same COMMAND_NOT_FOUND result as an
    // unknown command (design decision: hidden == unknown on that platform).
    const command = this.registry.get(commandName);
    const platformCapabilities = this.platformRegistry.capabilitiesFor(context.platform);
    const isAvailable =
      command?.requiredCapabilities.every((capability) => platformCapabilities.has(capability)) ??
      false;

    if (!(command && isAvailable)) {
      const result: CommandResult = {
        success: false,
        message: `Unknown command: ${commandName}`,
        error: {
          code: 'COMMAND_NOT_FOUND',
          message: `Command '${commandName}' does not exist`,
        },
      };
      await this.logExecution(commandName, context, result);
      return result;
    }

    // Check permissions
    const hasRequiredPermission = command.permissions.some((required) =>
      hasPermission(user.permissionLevel, required)
    );

    if (!hasRequiredPermission) {
      const result: CommandResult = {
        success: false,
        message: `Insufficient permissions for command: ${commandName}`,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Required permissions: ${command.permissions.join(', ')}`,
        },
      };
      await this.logExecution(commandName, context, result);
      return result;
    }

    // Check cooldown (skip for simulations)
    if (!context.isSimulation && command.cooldown > 0) {
      const cooldownKey = `${user.id}:${commandName}`;
      const cooldownEntry = this.cooldowns.get(cooldownKey);

      if (cooldownEntry && cooldownEntry.expiresAt > Date.now()) {
        const remainingSeconds = Math.ceil((cooldownEntry.expiresAt - Date.now()) / 1000);
        const result: CommandResult = {
          success: false,
          message: `Command on cooldown. Try again in ${remainingSeconds}s`,
          error: {
            code: 'COMMAND_ON_COOLDOWN',
            message: `Cooldown expires in ${remainingSeconds} seconds`,
            details: { remainingSeconds },
          },
        };
        return result; // Don't log cooldown rejections
      }
    }

    // Check if command can be executed (custom validation)
    if (command.canExecute) {
      const canExecute = await command.canExecute(context);
      if (!canExecute) {
        const result: CommandResult = {
          success: false,
          message: 'Command cannot be executed at this time',
          error: {
            code: 'EXECUTION_NOT_ALLOWED',
            message: 'Command validation failed',
          },
        };
        await this.logExecution(commandName, context, result);
        return result;
      }
    }

    // Execute command
    try {
      const result = await command.execute(context);

      // Set cooldown (skip for simulations)
      if (!context.isSimulation && command.cooldown > 0) {
        const cooldownKey = `${user.id}:${commandName}`;
        this.cooldowns.set(cooldownKey, {
          userId: user.id,
          commandName,
          expiresAt: Date.now() + command.cooldown * 1000,
        });

        // Clean up expired cooldowns periodically
        this.cleanupCooldowns();
      }

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

      const result: CommandResult = {
        success: false,
        message: 'Command execution failed',
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
      };

      await this.logExecution(commandName, context, result);
      return result;
    }
  }

  /**
   * Log command execution to history
   */
  private async logExecution(
    commandName: string,
    context: CommandContext,
    result: CommandResult
  ): Promise<void> {
    try {
      await this.historyRepository.create({
        commandName,
        userId: context.user.id,
        platform: context.platform,
        args: context.args,
        result,
        isSimulation: context.isSimulation,
        executedAt: Date.now(),
      });

      await this.eventBus.emit('command.executed', {
        command: commandName,
        username: context.user.username,
        userId: context.user.id,
        platform: context.platform,
        success: result.success,
        message: result.message,
        errorCode: result.error?.code,
        isSimulation: context.isSimulation,
      });
    } catch (error) {
      this.logger.error('Failed to log command execution', error);
    }
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

  /**
   * Clear all cooldowns (useful for testing)
   */
  clearCooldowns(): void {
    this.cooldowns.clear();
  }
}
