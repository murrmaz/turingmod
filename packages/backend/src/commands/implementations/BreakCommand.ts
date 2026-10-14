import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { BreakService, MAX_BREAK_SECONDS } from '../../breaks/BreakService.js';
import { formatCountdown } from '../../utils/FormatHelpers.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';

const DEFAULT_BREAK_SECONDS = 5 * 60;

/**
 * !break command
 * Starts a manual break (streamer off camera and mic, every platform's chat told), extends the
 * running one, or ends it early. Also the way to rehearse the ad-break overlay without waiting
 * for a real midroll.
 *
 * A successful start replies with nothing: BreakService already announces the break in every
 * platform's chat, including this one.
 */
@injectable()
export class BreakCommand implements ICommand {
  readonly name = 'break';
  readonly description = 'Start, extend or end a break (off camera and mic)';
  readonly usage = '!break [minutes | 90s | end]';
  readonly permissions = [PermissionLevel.MODERATOR];
  readonly cooldown = 0;
  // OBS + chat only — available on every platform.
  readonly requiredCapabilities: PlatformCapability[] = [];

  private logger: Logger;

  constructor(
    private breakService: BreakService,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'break' });
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const arg = (context.args[0] ?? '').toLowerCase();

    try {
      if (arg === 'end' || arg === 'stop') {
        const ended = await this.breakService.endBreak();
        return ended
          ? { success: true, message: '' }
          : { success: true, message: 'No break is running' };
      }

      const seconds = arg === '' ? DEFAULT_BREAK_SECONDS : parseDuration(arg);
      if (seconds === null || seconds <= 0 || seconds > MAX_BREAK_SECONDS) {
        return {
          success: false,
          message: `Usage: ${this.usage} (up to ${MAX_BREAK_SECONDS / 60} minutes)`,
          error: { code: 'INVALID_INPUT', message: `Invalid break length: ${arg}` },
        };
      }

      const { extended, endsAt } = await this.breakService.startBreak('manual', seconds);
      return {
        success: true,
        message: extended ? `Break extended; back in ${formatCountdown(endsAt - Date.now())}` : '',
        data: { extended, endsAt: new Date(endsAt).toISOString() },
      };
    } catch (error) {
      this.logger.error('Error in break command', error);
      return toCommandError(error, 'Failed to change the break');
    }
  }
}

/** "5" or "5m" → 300, "90s" → 90, "1.5" → 90. Null if unparseable. */
function parseDuration(input: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|s|sec|secs|seconds?)?$/.exec(input);
  if (!match?.[1]) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  const unit = match[2] ?? 'm';
  return Math.round(unit.startsWith('s') ? value : value * 60);
}

export default BreakCommand;
