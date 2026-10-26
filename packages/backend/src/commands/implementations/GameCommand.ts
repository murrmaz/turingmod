import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';
import { checkPermission } from '../utils/permissionChecks.js';
import { mirrorReply, ok } from '../utils/results.js';

/**
 * !game command
 * Shows the current stream game/category, or sets it (moderator only). Setting mirrors to every
 * live platform that supports SET_GAME (Twitch only in practice). Category name → id resolution
 * lives inside TwitchPlatform.
 */
@injectable()
export class GameCommand implements ICommand {
  readonly name = 'game';
  readonly description = 'Show or set the stream game/category';
  readonly usage = '!game [game name]';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Helix-backed read off the rate limit. Throttles the viewer-readable branch; moderators are exempt, so !game <name> stays responsive. */
  readonly cooldown = 30;
  readonly requiredCapabilities = [PlatformCapability.SET_GAME];

  private logger: Logger;

  constructor(
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'game' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { user, argText: gameName } = context;

    try {
      // Write mode: set new game (mirrors to all live platforms that support SET_GAME)
      if (gameName !== '') {
        const permissionError = checkPermission(
          user.permissionLevel,
          PermissionLevel.MODERATOR,
          'edit stream game'
        );
        if (permissionError) {
          return permissionError;
        }

        const mirror = await this.streamControl.setGame(gameName);
        return mirrorReply(
          mirror,
          'game',
          (platforms) => `Game changed to ${gameName} on ${platforms}`
        );
      }

      // Read mode: show current game on the origin platform
      const info = await this.streamControl.getStreamInfo(context.platform);

      if (!info.game || info.game === '') {
        return ok('No game/category set');
      }

      return ok(`Current Game: ${info.game}`);
    } catch (error) {
      this.logger.error('Error in game command', error);
      return toCommandError(error, 'Failed to get/set stream game');
    }
  }
}

export default GameCommand;
