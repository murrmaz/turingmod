import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { formatPlatformList } from '../../platforms/platformNames.js';
import type { Logger } from '../../utils/Logger.js';
import type { ICommand } from '../interfaces/ICommand.js';
import { checkPermission } from '../utils/permissionChecks.js';

/**
 * !title command
 * Shows the current stream title, or sets it (moderator only). Setting mirrors to every live
 * platform that supports SET_TITLE.
 */
export class TitleCommand implements ICommand {
  readonly name = 'title';
  readonly description = 'Show or set the stream title';
  readonly usage = '!title [new title]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities = [PlatformCapability.SET_TITLE];

  private streamControl: StreamControlService;
  private logger: Logger;

  constructor(container: Container) {
    this.streamControl = container.resolve<StreamControlService>('StreamControlService');
    this.logger = container.resolve<Logger>('Logger').child({ command: 'title' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, args } = context;

    try {
      // Write mode: set new title (mirrors to all live platforms that support SET_TITLE)
      if (args.length > 1) {
        const permissionError = checkPermission(
          user.permissionLevel,
          PermissionLevel.MODERATOR,
          'edit stream title'
        );
        if (permissionError) {
          return permissionError;
        }

        const newTitle = args.slice(1).join(' ').trim();

        if (newTitle === '') {
          return {
            success: false,
            message: 'Title cannot be empty',
            error: {
              code: 'INVALID_INPUT',
              message: 'Title must not be empty',
            },
          };
        }

        const mirror = await this.streamControl.setTitle(newTitle);

        if (mirror.updated.length === 0) {
          const reason = mirror.failures[0]?.error ?? 'No live platforms to update';
          return {
            success: false,
            message: `Failed to update title: ${reason}`,
            error: {
              code: 'API_ERROR',
              message: reason,
            },
          };
        }

        return {
          success: true,
          message: `Title updated on ${formatPlatformList(mirror.updated)}: ${newTitle}`,
          data: { title: newTitle, updated: mirror.updated },
        };
      }

      // Read mode: show current title on the origin platform
      const info = await this.streamControl.getStreamInfo(context.platform);

      return {
        success: true,
        message: `Stream Title: ${info.title}`,
        data: { title: info.title },
      };
    } catch (error) {
      this.logger.error('Error in title command', error);
      return {
        success: false,
        message: 'Failed to get/set stream title',
        error: {
          code: 'API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default TitleCommand;
