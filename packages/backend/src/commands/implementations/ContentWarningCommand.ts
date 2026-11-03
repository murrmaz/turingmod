import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { checkPermission } from '../utils/permissionChecks.js';
import { ok } from '../utils/results.js';

/**
 * !cw command
 * Shows or sets content classification labels (content warnings) on the platform the command
 * came from. Setting replaces the whole set; `!cw none` clears it.
 */
@injectable()
export class ContentWarningCommand implements ICommand {
  readonly name = 'cw';
  readonly description = 'Show or set content classification labels';
  readonly usage = '!cw [label1,label2,... | none]';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. Throttles the viewer-readable branch; moderators are exempt, so !cw <labels> stays responsive. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.CONTENT_LABELS];
  readonly failureMessage = 'Failed to get/set content labels';

  constructor(private streamControl: StreamControlService) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, argText, platform } = context;

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

      const labels =
        argText.toLowerCase() === 'none'
          ? []
          : argText
              .split(',')
              .map((label) => label.trim())
              .filter((label) => label !== '');

      await this.streamControl.require(platform, 'contentLabels').setContentLabels(labels);

      return ok(labels.length === 0 ? 'Content labels cleared' : 'Content labels updated');
    }

    // Read mode: show current labels
    const labels = await this.streamControl.require(platform, 'contentLabels').getContentLabels();

    if (labels.length === 0) {
      return ok('Content Labels: None');
    }

    return ok(`Content Labels: [${labels.join(', ')}]`);
  }
}

export default ContentWarningCommand;
