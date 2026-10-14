import type { CommandResult } from '@turingmod/shared';
import { messageOf, PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { checkPermission } from '../utils/permissionChecks.js';
import { fail, mirrorReply, ok } from '../utils/results.js';

/**
 * !tags command
 * Shows the current stream tags, or sets them (moderator only). Setting mirrors to every live
 * platform that supports SET_TAGS (Twitch only in practice).
 */
@injectable()
export class TagsCommand implements ICommand {
  readonly name = 'tags';
  readonly description = 'Show or set the stream tags';
  readonly usage = '!tags [tag1,tag2,...]';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. Throttles the viewer-readable branch; moderators are exempt, so !tags <list> stays responsive. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.SET_TAGS];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'tags' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, argText } = context;

    try {
      // Write mode: set new tags (mirrors to all live platforms that support SET_TAGS)
      if (argText !== '') {
        const permissionError = checkPermission(
          user.permissionLevel,
          PermissionLevel.MODERATOR,
          'edit stream tags'
        );
        if (permissionError) {
          return permissionError;
        }

        const tags = argText
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '');

        const mirror = await this.streamControl.setTags(tags);
        return mirrorReply(
          mirror,
          'tags',
          (platforms) => `Tags updated on ${platforms}: [${tags.join(', ')}]`
        );
      }

      // Read mode: show current tags on the origin platform
      const info = await this.streamControl.getStreamInfo(context.platform);
      const tags = info.tags;

      if (!tags || tags.length === 0) {
        return ok('Tags: None');
      }

      return ok(`Tags: [${tags.join(', ')}]`);
    } catch (error) {
      this.logger.error('Error in tags command', error);
      return fail('API_ERROR', 'Failed to get/set stream tags', messageOf(error));
    }
  }
}

export default TagsCommand;
