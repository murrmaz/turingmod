import type {
  CommandExecutePayload,
  CommandListPayload,
  CommandResultPayload,
  CommandSimulatePayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { MessageType, createCommandResultMessage } from '@turingmod/shared';
import type { CommandExecutor } from '../../commands/CommandExecutor.js';
import type { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { Logger } from '../../utils/Logger.js';

/**
 * Command message handler
 * Handles command execution and simulation requests
 */
export class CommandHandler {
  private logger: Logger;

  constructor(
    private commandExecutor: CommandExecutor,
    private commandRegistry: CommandRegistry,
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
   * Handle command list request
   */
  handleList(message: IWebSocketMessage): Promise<IWebSocketMessage<CommandListPayload>> {
    this.logger.debug('Getting command list');

    const commands = this.commandRegistry.getAll().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage,
      permissions: cmd.permissions,
      cooldown: cmd.cooldown,
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
