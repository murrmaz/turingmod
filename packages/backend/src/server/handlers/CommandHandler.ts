import type {
  CommandExecutePayload,
  CommandListPayload,
  CommandListRequestPayload,
  CommandResultPayload,
  CommandSimulatePayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { createCommandResultMessage, MessageType } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { CommandExecutor } from '../../commands/CommandExecutor.js';
import { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { ICommand } from '../../commands/interfaces/ICommand.js';
import { capabilitiesOf } from '../../platforms/capabilities.js';
import { PlatformRegistry } from '../../platforms/PlatformRegistry.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Command message handler
 * Handles command execution and simulation requests
 */
@injectable()
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
   * Handle command execute message
   */
  async handleExecute(
    message: IWebSocketMessage<CommandExecutePayload>
  ): Promise<IWebSocketMessage<CommandResultPayload>> {
    const { command, args, context } = message.payload;

    this.logger.info('Executing command', { command, user: context.user.username });

    // Execute command
    const result = await this.commandExecutor.execute({
      ...context,
      args,
    });

    // Create response
    return createCommandResultMessage({ command, result, isSimulation: false }, message.id);
  }

  /**
   * Handle command simulate message
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

    // Parse command text
    const parts = commandText.trim().split(/\s+/);
    const commandName = parts[0]?.replace(/^!/, '') || '';
    const args = parts;

    // Create simulated context
    const context = {
      user: {
        id: simulatedUser.userId || `sim-${Date.now()}`,
        platform,
        platformUserId: simulatedUser.userId || `sim-${Date.now()}`,
        username: simulatedUser.username,
        permissionLevel: simulatedUser.permissionLevel,
      },
      args,
      platform,
      metadata: {
        simulated: true,
      },
      isSimulation: true,
    };

    // Execute command
    const result = await this.commandExecutor.execute(context);

    // Create response
    return createCommandResultMessage(
      { command: commandName, result, isSimulation: true },
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
