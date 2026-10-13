import 'reflect-metadata';
import {
  type CommandListPayload,
  MessageType,
  PlatformCapability,
  StreamingPlatform,
} from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import type { OwnChatMessages } from '../../chat/OwnChatMessages.js';
import type { CommandExecutor } from '../../commands/CommandExecutor.js';
import { CommandRegistry } from '../../commands/CommandRegistry.js';
import type { ICommand } from '../../commands/interfaces/ICommand.js';
import type { TwitchApiIntegration } from '../../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../../integrations/implementations/twitch/TwitchAuthIntegration.js';
import type { YouTubeApiIntegration } from '../../integrations/implementations/youtube/YouTubeApiIntegration.js';
import type { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { PlatformRegistry } from '../../platforms/PlatformRegistry.js';
import { TwitchPlatform } from '../../platforms/TwitchPlatform.js';
import { YouTubePlatform } from '../../platforms/YouTubePlatform.js';
import { Logger } from '../../utils/Logger.js';
import { CommandHandler } from './CommandHandler.js';

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

describe('CommandHandler.handleList', () => {
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
        {} as YouTubeApiIntegration,
        {} as OwnChatMessages,
        {} as YouTubeChatIntegration
      )
    );
    const handler = new CommandHandler({} as CommandExecutor, commands, platforms, logger);

    const response = await handler.handleList({
      id: '1',
      type: MessageType.COMMAND_LIST,
      timestamp: 0,
      payload: {},
    });

    const available = Object.fromEntries(
      (response.payload as CommandListPayload).commands.map((c) => [c.name, c.availableOn])
    );
    expect(available).toEqual({
      uptime: [StreamingPlatform.TWITCH, StreamingPlatform.YOUTUBE],
      ad: [StreamingPlatform.TWITCH],
    });
  });
});
