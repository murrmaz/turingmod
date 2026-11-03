import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { ok } from '../utils/results.js';

/**
 * e.g. "3:05 PM CDT" — the zone abbreviation follows daylight saving. TuringMod only listens on
 * localhost, so it runs on the streamer's own machine, and that machine's time zone is theirs;
 * `timeZone` is for tests.
 */
export function streamerTime(now = new Date(), timeZone?: string): string {
  return now.toLocaleTimeString('en-US', {
    ...(timeZone === undefined ? {} : { timeZone }),
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * !time command
 * The streamer's local time.
 */
@injectable()
export class TimeCommand implements ICommand {
  readonly name = 'time';
  readonly description = "Show the streamer's local time";
  readonly usage = '!time';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  execute(context: CommandContext): Promise<CommandResult> {
    return Promise.resolve(
      ok(`@${context.user.username}: Currently ${streamerTime()} for the streamer`)
    );
  }
}

export default TimeCommand;
