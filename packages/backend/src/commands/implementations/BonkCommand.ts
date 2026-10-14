import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { CLIPS } from '../../sounds/clips.js';
import { SoundLibrary } from '../../sounds/SoundLibrary.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';

/** How often a bonk of someone else lands on the bonker instead. */
export const BONK_REVOLT_CHANCE = 0.1;

/**
 * Example command: !bonk
 * Bonks a user (playful command for demonstration)
 */
@injectable()
export class BonkCommand implements ICommand {
  readonly name = 'bonk';
  readonly description = 'Bonk a user (playful command)';
  readonly usage = '!bonk @username';
  readonly permissions = [PermissionLevel.VIEWER]; // Everyone can use it
  readonly cooldown = 5; // 5 second cooldown
  // Sound + chat only — available on every platform.
  readonly requiredCapabilities: PlatformCapability[] = [];

  private bonkCounts = new Map<string, number>();

  constructor(private sounds: SoundLibrary) {}

  execute(context: CommandContext): Promise<CommandResult> {
    const { user, args } = context;

    // Parse target from args (e.g., "!bonk @username")
    const requested = args[0]?.replace(/^@/, '') || user.username;
    // One time in ten the bot turns on whoever asked, as the original did.
    const revolt = requested !== user.username && Math.random() < BONK_REVOLT_CHANCE;
    const target = revolt ? user.username : requested;

    // Increment bonk count
    const currentCount = this.bonkCounts.get(target) || 0;
    const newCount = currentCount + 1;
    this.bonkCounts.set(target, newCount);

    // Generate response message
    const message = revolt
      ? `The bot got tired of doing whatever the meatbags want and bonked ${user.username} instead (Total: ${newCount})`
      : target === user.username
        ? `${user.username} bonked themselves! (Total: ${newCount})`
        : `${user.username} bonked ${target}! (Total: ${newCount})`;

    void this.sounds.tryPlay(CLIPS.bonk);

    return Promise.resolve({
      success: true,
      message,
      data: {
        target,
        bonkCount: newCount,
        bonkedBy: user.username,
        revolt,
      },
    });
  }

  /**
   * Get bonk count for a user
   */
  getBonkCount(username: string): number {
    return this.bonkCounts.get(username) || 0;
  }

  /**
   * Reset bonk counts (for testing)
   */
  resetCounts(): void {
    this.bonkCounts.clear();
  }
}

export default BonkCommand;
