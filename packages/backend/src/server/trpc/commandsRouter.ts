import { SimulatedUserSchema, StreamingPlatform } from '@turingmod/shared';
import { z } from 'zod';
import type { CommandExecutor } from '../../commands/CommandExecutor.js';
import type { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { CommandContext, ICommand } from '../../commands/interfaces/ICommand.js';
import { parseCommand } from '../../commands/parseCommand.js';
import { fail } from '../../commands/utils/results.js';
import { capabilitiesOf } from '../../platforms/capabilities.js';
import type { PlatformRegistry } from '../../platforms/PlatformRegistry.js';
import type { Logger } from '../../utils/Logger.js';
import { procedure, router } from './trpc.js';

/** The command table, and the simulator that runs commands for real as a chosen viewer. */
export function createCommandsRouter(
  commandExecutor: CommandExecutor,
  commandRegistry: CommandRegistry,
  platformRegistry: PlatformRegistry,
  logger: Logger
) {
  const log = logger.child({ component: 'CommandsRouter' });

  return router({
    /**
     * Every command, with the platforms each is available on (its requiredCapabilities ⊆ the
     * platform's capabilities). Given a platform, only the commands available there.
     */
    list: procedure
      .input(z.strictObject({ platform: z.enum(StreamingPlatform).exactOptional() }))
      .query(({ input: { platform } }) => {
        const source: ICommand[] = platform
          ? commandRegistry.getAllForPlatform(platformRegistry.capabilitiesFor(platform))
          : commandRegistry.getAll();

        const platforms = platformRegistry.getAll().map((target) => ({
          platform: target.platform,
          capabilities: capabilitiesOf(target),
        }));
        return source.map((cmd) => ({
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
