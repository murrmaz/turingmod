import type {
  CommandListPayload,
  CommandListRequestPayload,
  CommandResultPayload,
  CommandSimulatePayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { createCommandResultMessage, MessageType } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { CommandExecutor } from '../../commands/CommandExecutor.js';
import { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { CommandContext, ICommand } from '../../commands/interfaces/ICommand.js';
import { parseCommand } from '../../commands/parseCommand.js';
import { fail } from '../../commands/utils/results.js';
import { capabilitiesOf } from '../../platforms/capabilities.js';
import { PlatformRegistry } from '../../platforms/PlatformRegistry.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Command message handler
 * Handles command simulation and list requests
 */
@singleton()
export class CommandHandler {
  private logger: Logger;

  constructor(
    private commandExecutor: CommandExecutor,
    private commandRegistry: CommandRegistry,
    private platformRegistry: PlatformRegistry,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'CommandHandler' });
  }

  /**
   * Run a command typed into the simulator, parsed exactly as it would be from chat.
   */
  async handleSimulate(
    message: IWebSocketMessage<CommandSimulatePayload>
  ): Promise<IWebSocketMessage<CommandResultPayload>> {
    const { commandText, simulatedUser, platform } = message.payload;

    this.logger.info('Simulating command', {
      commandText,
      user: simulatedUser.username,
      permissionLevel: simulatedUser.permissionLevel,
    });

    const parsed = parseCommand(commandText);
    if (!parsed) {
      return createCommandResultMessage(
        {
          command: commandText,
          result: fail(
            'INVALID_INPUT',
            'Not a command: chat would only run text starting with ! and a name',
            'Not a command'
          ),
          isSimulation: true,
        },
        message.id
      );
    }

    const context: CommandContext = {
      ...parsed,
      user: {
        id: simulatedUser.userId || `sim-${Date.now()}`,
        platform,
        platformUserId: simulatedUser.userId || `sim-${Date.now()}`,
        username: simulatedUser.username,
        permissionLevel: simulatedUser.permissionLevel,
      },
      platform,
      isSimulation: true,
    };

    const result = await this.commandExecutor.execute(context);

    return createCommandResultMessage(
      { command: parsed.command, result, isSimulation: true },
      message.id
    );
  }

  /**
   * Handle command list request. When the request carries a platform, only commands available on
   * that platform (requiredCapabilities ⊆ platform capabilities) are returned.
   */
  handleList(
    message: IWebSocketMessage<CommandListRequestPayload>
  ): Promise<IWebSocketMessage<CommandListPayload>> {
    const { platform } = message.payload;
    this.logger.debug('Getting command list', { platform });

    const source: ICommand[] = platform
      ? this.commandRegistry.getAllForPlatform(this.platformRegistry.capabilitiesFor(platform))
      : this.commandRegistry.getAll();

    const platforms = this.platformRegistry.getAll().map((target) => ({
      platform: target.platform,
      capabilities: capabilitiesOf(target),
    }));
    const commands = source.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage,
      permissions: cmd.permissions,
      cooldown: cmd.cooldown,
      requiredCapabilities: cmd.requiredCapabilities,
      availableOn: platforms
        .filter(({ capabilities }) =>
          cmd.requiredCapabilities.every((capability) => capabilities.has(capability))
        )
        .map(({ platform }) => platform),
    }));

    return Promise.resolve({
      id: message.id,
      type: MessageType.COMMAND_LIST,
      timestamp: Date.now(),
      payload: {
        commands,
      },
    });
  }
}
