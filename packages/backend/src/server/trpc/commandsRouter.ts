import { platformDisplayName, SimulatedUserSchema, StreamingPlatform } from '@turingmod/shared';
import { z } from 'zod';
import type { CommandAvailability } from '../../features/commands/CommandAvailability.js';
import type { CommandExecutor } from '../../features/commands/CommandExecutor.js';
import type { CommandRegistry } from '../../features/commands/CommandRegistry.js';
import type { CommandContext, ICommand } from '../../features/commands/interfaces/ICommand.js';
import { parseCommand } from '../../features/commands/parseCommand.js';
import { toCommandError } from '../../features/commands/utils/commandErrors.js';
import { fail } from '../../features/commands/utils/results.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import type { Logger } from '../../utils/Logger.js';
import { procedure, router } from './trpc.js';

/** The command table, and the simulator that runs commands for real as a chosen viewer. */
export function createCommandsRouter(
  commandExecutor: CommandExecutor,
  commandRegistry: CommandRegistry,
  commandAvailability: CommandAvailability,
  streamControl: StreamControlService,
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
     * be from chat: anything chat wouldn't run as a command is answered as not being one. A command
     * that gives the platform the viewer's id runs as the real user with the simulated username;
     * any other gets a placeholder id made from the username, so it runs for a made-up name or a
     * disconnected platform.
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
      .mutation(async ({ input: { commandText, simulatedUser, platform } }) => {
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

        const { username } = simulatedUser;
        // Made from the name, so a simulated viewer is the same viewer from one run to the next:
        // `!unlurk` finds the `!lurk` before it.
        let userId = simulatedUser.userId ?? `sim-${username.toLowerCase()}`;
        const needsRealId = commandAvailability.find(parsed.command, platform)?.usesPlatformUserId;
        if (needsRealId && !simulatedUser.userId) {
          try {
            const found = await streamControl.require(platform, 'userLookup').findUserId(username);
            if (!found) {
              const message = `No ${platformDisplayName(platform)} user named ${username}`;
              return fail('INVALID_INPUT', message, message);
            }
            userId = found;
          } catch (error) {
            log.error('Failed to look up the simulated user', error, { user: username });
            return toCommandError(error, `Failed to look up ${username}`);
          }
        }

        const context: CommandContext = {
          ...parsed,
          user: {
            platformUserId: userId,
            username,
            permissionLevel: simulatedUser.permissionLevel,
          },
          platform,
          isSimulation: true,
        };
        return commandExecutor.execute(context);
      }),
  });
}
