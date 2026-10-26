import 'reflect-metadata';
import { PermissionLevel, PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { OwnChatMessages } from '../../chat/OwnChatMessages.js';
import type { CommandExecutor } from '../../commands/CommandExecutor.js';
import { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { ICommand } from '../../commands/interfaces/ICommand.js';
import { errorCodeOf } from '../../commands/testing.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/twitch/TwitchAuthIntegration.js';
import type { YouTubeApiIntegration } from '../../integrations/implementations/youtube/YouTubeApiIntegration.js';
import type { YouTubeAuthIntegration } from '../../integrations/implementations/youtube/YouTubeAuthIntegration.js';
import type { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { PlatformRegistry } from '../../platforms/PlatformRegistry.js';
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
      createCommandsRouter({} as CommandExecutor, commands, platforms, logger)
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
  const simulate = (commandText: string) => {
    const execute = vi.fn(() => Promise.resolve({ success: true, message: 'ok' }));
    const logger = new Logger({ level: 'silent' });
    const caller = createCallerFactory(
      createCommandsRouter(
        { execute } as unknown as CommandExecutor,
        new CommandRegistry(logger),
        new PlatformRegistry(),
        logger
      )
    )({ consoleOrigin: null });
    const response = caller.simulate({
      commandText,
      simulatedUser: { username: 'someone', permissionLevel: PermissionLevel.VIEWER },
      platform: StreamingPlatform.TWITCH,
    });
    return { execute, response };
  };

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
