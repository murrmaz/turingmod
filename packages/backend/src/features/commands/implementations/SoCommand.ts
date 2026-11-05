import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { failureReporter, type ReportFailure } from '../../../core/failures.js';
import { InvalidStreamInfoError, NotAuthenticatedError } from '../../../platforms/errors.js';
import { StreamControlService } from '../../../platforms/StreamControlService.js';
import { Logger } from '../../../utils/Logger.js';
import { raidShoutoutMessage } from '../../raids/RaidShoutout.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { fail, ok } from '../utils/results.js';

/**
 * !so command
 * Shouts out another channel: the same chat message a raid gets, plus the platform's native
 * shoutout. A channel that doesn't exist gets neither, and chat is told.
 *
 * Unlike other commands this catches a failed call, because chat's message is still worth posting
 * without the native shoutout: the failure goes to the streamer instead. Twitch rate-limits native
 * shoutouts, so one it declines for that is only logged.
 */
@injectable()
export default class SoCommand implements ICommand {
  readonly name = 'so';
  readonly description = 'Shout out another channel';
  readonly usage = '!so <channel>';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.SHOUTOUT];
  readonly failureMessage = 'Failed to send the shoutout';

  private logger: Logger;
  private report: ReportFailure;

  constructor(
    eventBus: EventBus,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'so' });
    this.report = failureReporter(eventBus, this.logger, 'Shoutouts');
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const channel = context.args[0]?.replace(/^@/, '');
    if (!channel) {
      return fail('INVALID_INPUT', `Usage: ${this.usage}`, 'No channel given');
    }

    try {
      const result = await this.streamControl
        .require(context.platform, 'shoutout')
        .shoutout(channel);
      if (!result.sent) {
        this.logger.info(
          `Native shoutout for ${channel} declined: ${result.reason ?? 'rate limited'}`
        );
      }
    } catch (error) {
      // Both are answers for CommandExecutor: chat shouldn't be sent to a channel that isn't there.
      if (error instanceof InvalidStreamInfoError || error instanceof NotAuthenticatedError) {
        throw error;
      }
      this.report(
        `Could not send the native shoutout for ${channel}; chat still got the message.`,
        error
      );
    }

    return ok(raidShoutoutMessage(channel));
  }
}
