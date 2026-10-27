import { SimulatedUserSchema, StreamingPlatform } from '@turingmod/shared';
import { z } from 'zod';
import type { CommandAvailability } from '../../commands/CommandAvailability.js';
import type { CommandExecutor } from '../../commands/CommandExecutor.js';
import type { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { CommandContext, ICommand } from '../../commands/interfaces/ICommand.js';
import { parseCommand } from '../../commands/parseCommand.js';
import { fail } from '../../commands/utils/results.js';
import type { Logger } from '../../utils/Logger.js';
import { procedure, router } from './trpc.js';

/** The command table, and the simulator that runs commands for real as a chosen viewer. */
export function createCommandsRouter(
  commandExecutor: CommandExecutor,
  commandRegistry: CommandRegistry,
  commandAvailability: CommandAvailability,
  logger: Logger
) {
  const log = logger.child({ component: 'CommandsRouter' });

  return router({
    /**
     * Every command, with the platforms each is offered on. Given a platform, only the commands
     * offered there.
     */
    list: procedure
      .input(z.strictObject({ platform: z.enum(StreamingPlatform).exactOptional() }))
      .query(({ input: { platform } }) => {
        const source: ICommand[] = platform
          ? commandAvailability.listFor(platform)
          : commandRegistry.getAll();

        return source.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          usage: cmd.usage,
          permissions: cmd.permissions,
          cooldown: cmd.cooldown,
          availableOn: commandAvailability.platformsFor(cmd),
        }));
      }),

    /**
     * Run a command typed into the simulator, side effects included, parsed exactly as it would
     * be from chat: anything chat wouldn't run as a command is answered as not being one.
     */
    simulate: procedure
      .input(
        z.strictObject({
          /** Full command text (e.g., "!bonk @username") */
          commandText: z.string().min(1),
          simulatedUser: SimulatedUserSchema,
          platform: z.enum(StreamingPlatform),
        })
      )
      .mutation(({ input: { commandText, simulatedUser, platform } }) => {
        log.info('Simulating command', {
          commandText,
          user: simulatedUser.username,
          permissionLevel: simulatedUser.permissionLevel,
        });

        const parsed = parseCommand(commandText);
        if (!parsed) {
          return fail(
            'INVALID_INPUT',
            'Not a command: chat would only run text starting with ! and a name',
            'Not a command'
          );
        }

        const userId = simulatedUser.userId || `sim-${Date.now()}`;
        const context: CommandContext = {
          ...parsed,
          user: {
            id: userId,
            platform,
            platformUserId: userId,
            username: simulatedUser.username,
            permissionLevel: simulatedUser.permissionLevel,
          },
          platform,
          isSimulation: true,
        };
        return commandExecutor.execute(context);
      }),
  });
}
