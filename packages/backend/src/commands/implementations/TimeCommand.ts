import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import type { ICommand } from '../interfaces/ICommand.js';

/** Where the streamer is (Chicagoland, per the original bot). */
export const STREAMER_TIME_ZONE = 'America/Chicago';

/** e.g. "3:05 PM CDT" — the zone abbreviation follows daylight saving. */
export function streamerTime(now = new Date()): string {
  return now.toLocaleTimeString('en-US', {
    timeZone: STREAMER_TIME_ZONE,
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
    return Promise.resolve({
      success: true,
      message: `@${context.user.username}: Currently ${streamerTime()} for the streamer`,
    });
  }
}

export default TimeCommand;
