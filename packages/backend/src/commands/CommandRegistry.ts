import type { PlatformCapability } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Command registry
 * Manages command registration and lookup
 */
@injectable()
@singleton()
export class CommandRegistry {
  private commands = new Map<string, ICommand>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'CommandRegistry' });
  }

  /**
   * Register a command. Names are lowercase, since `parseCommand()` lowercases what was typed.
   */
  register(command: ICommand): void {
    if (command.name !== command.name.toLowerCase()) {
      throw new Error(`Command names must be lowercase: ${command.name}`);
    }
    if (this.commands.has(command.name)) {
      throw new Error(`Command already registered: ${command.name}`);
    }

    this.commands.set(command.name, command);
    this.logger.info(`Registered command: ${command.name}`);
  }

  /**
   * Get a command by name
   */
  get(name: string): ICommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all registered commands
   */
  getAll(): ICommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get all commands available on a platform with the given capability set — i.e. every command
   * whose requiredCapabilities are all present in `caps`.
   */
  getAllForPlatform(caps: Set<PlatformCapability>): ICommand[] {
    return this.getAll().filter((command) =>
      command.requiredCapabilities.every((capability) => caps.has(capability))
    );
  }

  /**
   * Check if a command is registered
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get command count
   */
  count(): number {
    return this.commands.size;
  }

  /**
   * Clear all commands
   */
  clear(): void {
    this.commands.clear();
    this.logger.info('Cleared all commands');
  }
}
