import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { raidShoutoutMessage } from '../../raids/RaidShoutout.js';
import { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * !so command
 * Shouts out another channel: the same chat message a raid gets, plus the platform's native
 * shoutout. The native one is rate-limited by Twitch, so it's best-effort.
 */
@injectable()
export class SoCommand implements ICommand {
  readonly name = 'so';
  readonly description = 'Shout out another channel';
  readonly usage = '!so <channel>';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.SHOUTOUT];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'so' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const channel = context.args[1]?.replace(/^@/, '').trim();
    if (!channel) {
      return {
        success: false,
        message: `Usage: ${this.usage}`,
        error: { code: 'INVALID_INPUT', message: 'No channel given' },
      };
    }

    try {
      const result = await this.streamControl.shoutout(context.platform, channel);
      if (!result.sent) {
        this.logger.info(
          `Native shoutout for ${channel} declined: ${result.reason ?? 'rate limited'}`
        );
      }
    } catch (error) {
      this.logger.warn(`Native shoutout for ${channel} failed`, error);
    }

    return { success: true, message: raidShoutoutMessage(channel) };
  }
}

export default SoCommand;
