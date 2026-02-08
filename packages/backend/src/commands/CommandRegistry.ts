import type { Logger } from '../utils/Logger.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Command registry
 * Manages command registration and lookup
 */
export class CommandRegistry {
  private commands = new Map<string, ICommand>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'CommandRegistry' });
  }

  /**
   * Register a command
   */
  register(command: ICommand): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command already registered: ${command.name}`);
    }

    this.commands.set(command.name, command);
    this.logger.info(`Registered command: ${command.name}`);
  }

  /**
   * Unregister a command
   */
  unregister(name: string): boolean {
    const existed = this.commands.delete(name);
    if (existed) {
      this.logger.info(`Unregistered command: ${name}`);
    }
    return existed;
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
