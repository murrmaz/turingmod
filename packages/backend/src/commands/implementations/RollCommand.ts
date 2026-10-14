import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { fail, ok } from '../utils/results.js';

const MAX_DICE = 1000;
const MAX_SIDES = 1_000_000;

/** A roll like `d20`, `3d6` or `2d10r5` (at least 5). Null if it isn't one. */
export function parseRoll(input: string): { count: number; sides: number; minimum: number } | null {
  const match = /^(\d*)d(\d+)(?:r(\d+))?$/i.exec(input.trim());
  if (!match) return null;
  return {
    count: match[1] ? Number(match[1]) : 1,
    sides: Number(match[2]),
    minimum: match[3] ? Number(match[3]) : 0,
  };
}

/**
 * !roll command
 * Rolls dice: `!roll 2d6`, optionally with a minimum total (`!roll 2d6r4`), which a lower roll
 * is raised to, as in the original bot.
 */
@injectable()
export class RollCommand implements ICommand {
  readonly name = 'roll';
  readonly description = 'Roll dice';
  readonly usage = '!roll [count]d<sides>[r<minimum>]';
  readonly permissions = [PermissionLevel.VIEWER];
  readonly cooldown = 0;
  readonly requiredCapabilities: PlatformCapability[] = [];

  execute(context: CommandContext): Promise<CommandResult> {
    const user = context.user.username;
    const roll = parseRoll(context.args[0] ?? '');
    if (!roll || roll.count < 1 || roll.sides < 1) {
      return Promise.resolve(
        fail('INVALID_INPUT', `@${user}: Usage: ${this.usage}, e.g. !roll 2d6`, 'Not a dice roll')
      );
    }
    if (roll.count > MAX_DICE || roll.sides > MAX_SIDES) {
      return Promise.resolve(
        fail(
          'INVALID_INPUT',
          `@${user}: Amount to roll or number of sides too high`,
          'Roll too large'
        )
      );
    }
    if (roll.minimum > roll.count * roll.sides) {
      return Promise.resolve(
        fail(
          'INVALID_INPUT',
          `@${user}: Minimum roll was higher than possible highest roll`,
          'Minimum out of range'
        )
      );
    }

    let total = 0;
    for (let i = 0; i < roll.count; i++) {
      total += Math.floor(Math.random() * roll.sides) + 1;
    }
    total = Math.max(total, roll.minimum);

    return Promise.resolve(
      ok(`@${user}: You rolled ${roll.count} d${roll.sides} and got ${total}`)
    );
  }
}

export default RollCommand;
