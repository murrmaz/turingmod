import type { PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

/**
 * Which commands each platform offers: the one place the rule is applied, so chat, the simulator
 * and the console's command table can't disagree.
 *
 * A command never names platforms. It declares what it needs (`requiredCapabilities`), each
 * façade's capability objects say what its platform can do, and a command is offered wherever
 * every capability it needs is there. Worked out on each request rather than at registration, so
 * it doesn't matter whether commands or platforms are registered first.
 */
@singleton()
export class CommandAvailability {
  constructor(
    private readonly commands: CommandRegistry,
    private readonly platforms: PlatformRegistry
  ) {}

  /**
   * The command named `name`, if it exists and is offered on `platform`. One that exists but
   * isn't offered there is undefined too: hidden is the same as unknown on that platform.
   */
  find(name: string, platform: StreamingPlatform): ICommand | undefined {
    const command = this.commands.get(name);
    return command && isOffered(command, this.platforms.capabilitiesFor(platform))
      ? command
      : undefined;
  }

  /** Every command offered on `platform`. */
  listFor(platform: StreamingPlatform): ICommand[] {
    const capabilities = this.platforms.capabilitiesFor(platform);
    return this.commands.getAll().filter((command) => isOffered(command, capabilities));
  }

  /** The platforms `command` is offered on, in registration order. */
  platformsFor(command: ICommand): StreamingPlatform[] {
    return this.platforms
      .getAll()
      .filter(({ platform }) => isOffered(command, this.platforms.capabilitiesFor(platform)))
      .map(({ platform }) => platform);
  }
}

function isOffered(command: ICommand, capabilities: ReadonlySet<PlatformCapability>): boolean {
  return command.requiredCapabilities.every((capability) => capabilities.has(capability));
}
