import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';
import { checkPermission } from '../utils/permissionChecks.js';

/**
 * !cw command
 * Shows or sets content classification labels (content warnings) on the platform the command
 * came from.
 */
@injectable()
export class ContentWarningCommand implements ICommand {
  readonly name = 'cw';
  readonly description = 'Show or set content classification labels';
  readonly usage = '!cw [label1,label2,...]';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. Throttles the viewer-readable branch; moderators are exempt, so !cw <labels> stays responsive. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.CONTENT_LABELS];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'cw' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, argText, platform } = context;

    try {
      // Write mode: set new labels
      if (argText !== '') {
        const permissionError = checkPermission(
          user.permissionLevel,
          PermissionLevel.MODERATOR,
          'edit content labels'
        );
        if (permissionError) {
          return permissionError;
        }

        const labels = argText
          .split(',')
          .map((label) => label.trim())
          .filter((label) => label !== '');

        await this.streamControl.require(platform, 'contentLabels').setContentLabels(labels);

        return {
          success: true,
          message: 'Content labels updated',
          data: { labels },
        };
      }

      // Read mode: show current labels
      const labels = await this.streamControl.require(platform, 'contentLabels').getContentLabels();

      if (labels.length === 0) {
        return {
          success: true,
          message: 'Content Labels: None',
          data: { labels: [] },
        };
      }

      return {
        success: true,
        message: `Content Labels: [${labels.join(', ')}]`,
        data: { labels },
      };
    } catch (error) {
      this.logger.error('Error in cw command', error);
      return toCommandError(error, 'Failed to get/set content labels');
    }
  }
}

export default ContentWarningCommand;
