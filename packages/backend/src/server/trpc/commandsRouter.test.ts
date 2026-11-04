import 'reflect-metadata';
import { PermissionLevel, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { CommandAvailability } from '../../features/commands/CommandAvailability.js';
import type { CommandExecutor } from '../../features/commands/CommandExecutor.js';
import { CommandRegistry } from '../../features/commands/CommandRegistry.js';
import type { CommandContext, ICommand } from '../../features/commands/interfaces/ICommand.js';
import { errorCodeOf } from '../../features/commands/testing.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/twitch/TwitchAuthIntegration.js';
import type { YouTubeApiIntegration } from '../../integrations/implementations/youtube/YouTubeApiIntegration.js';
import type { YouTubeAuthIntegration } from '../../integrations/implementations/youtube/YouTubeAuthIntegration.js';
import type { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { NotAuthenticatedError } from '../../platforms/errors.js';
import type { OwnChatMessages } from '../../platforms/OwnChatMessages.js';
import { PlatformRegistry } from '../../platforms/PlatformRegistry.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { TwitchPlatform } from '../../platforms/TwitchPlatform.js';
import { YouTubePlatform } from '../../platforms/YouTubePlatform.js';
import { Logger } from '../../utils/Logger.js';
import { createCommandsRouter } from './commandsRouter.js';
import { createCallerFactory } from './trpc.js';

const command = (name: string, requiredCapabilities: PlatformCapability[]) =>
  ({
    name,
    description: '',
    usage: `!${name}`,
    permissions: [],
    cooldown: 0,
    requiredCapabilities,
    execute: () => Promise.resolve({ success: true, message: '' }),
  }) as unknown as ICommand;

describe('commands.list', () => {
  it("lists each command's platforms from the façades' capabilities", async () => {
    const logger = new Logger({ level: 'silent' });
    const commands = new CommandRegistry(logger);
    commands.register(command('uptime', [PlatformCapability.UPTIME]));
    commands.register(command('ad', [PlatformCapability.ADS]));
    const platforms = new PlatformRegistry();
    platforms.register(
      new TwitchPlatform(
        {} as TwitchAuthIntegration,
        {} as TwitchApiIntegration,
        {} as OwnChatMessages
      )
    );
    platforms.register(
      new YouTubePlatform(
        {} as YouTubeAuthIntegration,
        {} as YouTubeApiIntegration,
        {} as OwnChatMessages,
        {} as YouTubeChatIntegration
      )
    );
    const caller = createCallerFactory(
      createCommandsRouter(
        {} as CommandExecutor,
        commands,
        new CommandAvailability(commands, platforms),
        {} as StreamControlService,
        logger
      )
    )({ consoleOrigin: null });

    const available = Object.fromEntries(
      (await caller.list({})).map((c) => [c.name, c.availableOn])
    );
    expect(available).toEqual({
      uptime: [StreamingPlatform.TWITCH, StreamingPlatform.YOUTUBE],
      ad: [StreamingPlatform.TWITCH],
    });
  });
});

describe('commands.simulate', () => {
  const simulate = (
    commandText: string,
    findUserId: (username: string) => Promise<string | null> = () => Promise.resolve('12345'),
    simulatedUserId?: string
  ) => {
    const execute = vi.fn((_context: CommandContext) =>
      Promise.resolve({ success: true, message: 'ok' })
    );
    const lookup = vi.fn(findUserId);
    const logger = new Logger({ level: 'silent' });
    const commands: Record<string, Partial<ICommand>> = {
      accountage: { usesPlatformUserId: true },
      bonk: {},
    };
    const caller = createCallerFactory(
      createCommandsRouter(
        { execute } as unknown as CommandExecutor,
        new CommandRegistry(logger),
        { find: (name: string) => commands[name] } as unknown as CommandAvailability,
        { require: () => ({ findUserId: lookup }) } as unknown as StreamControlService,
        logger
      )
    )({ consoleOrigin: null });
    const response = caller.simulate({
      commandText,
      simulatedUser: {
        username: 'someone',
        permissionLevel: PermissionLevel.VIEWER,
        ...(simulatedUserId === undefined ? {} : { userId: simulatedUserId }),
      },
      platform: StreamingPlatform.TWITCH,
    });
    return { execute, lookup, response };
  };

  it('runs a command that uses the viewer id as the real user with that username', async () => {
    const { execute, lookup, response } = simulate('!accountage');
    await response;

    expect(lookup).toHaveBeenCalledWith('someone');
    expect(execute.mock.calls[0]?.[0].user.platformUserId).toBe('12345');
  });

  it('answers with a clear failure for a username the platform does not have', async () => {
    const { execute, response } = simulate('!accountage', () => Promise.resolve(null));
    const result = await response;

    expect(errorCodeOf(result)).toBe('INVALID_INPUT');
    expect(result.message).toBe('No Twitch user named someone');
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports a failed lookup instead of running the command', async () => {
    const { execute, response } = simulate('!accountage', () =>
      Promise.reject(
        new NotAuthenticatedError(StreamingPlatform.TWITCH, false, 'Twitch is not connected')
      )
    );

    expect(errorCodeOf(await response)).toBe('NOT_AUTHENTICATED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses an id it was given rather than looking one up', async () => {
    const { execute, lookup, response } = simulate('!accountage', undefined, '999');
    await response;

    expect(lookup).not.toHaveBeenCalled();
    expect(execute.mock.calls[0]?.[0].user.platformUserId).toBe('999');
  });

  it('asks the platform nothing for a command that does not use the viewer id', async () => {
    const { execute, lookup, response } = simulate('!bonk', () =>
      Promise.reject(new Error('should not be asked'))
    );
    await response;

    expect(lookup).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it('parses the text exactly as chat would', async () => {
    const { execute } = simulate('!So  @coolraider');
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'so', args: ['@coolraider'], isSimulation: true })
    );
  });

  it('runs nothing for text chat would not treat as a command', async () => {
    const { execute, response } = simulate('so @coolraider');

    expect(errorCodeOf(await response)).toBe('INVALID_INPUT');
    expect(execute).not.toHaveBeenCalled();
  });
});
