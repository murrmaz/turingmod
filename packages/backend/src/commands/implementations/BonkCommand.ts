import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext, CommandResult } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import type { Container } from '../../core/Container.js';
import type { EventBus } from '../../core/EventBus.js';
import type { ICommand } from '../interfaces/ICommand.js';

/**
 * Example command: !bonk
 * Bonks a user (playful command for demonstration)
 */
export class BonkCommand implements ICommand {
  readonly name = 'bonk';
  readonly description = 'Bonk a user (playful command)';
  readonly usage = '!bonk @username';
  readonly permissions = [PermissionLevel.VIEWER]; // Everyone can use it
  readonly cooldown = 5; // 5 second cooldown

  private bonkCounts = new Map<string, number>();
  private eventBus: EventBus;
  private bonkSoundPath: string;

  constructor(container: Container) {
    this.eventBus = container.resolve<EventBus>('EventBus');
    const dirname = fileURLToPath(new URL('.', import.meta.url));
    this.bonkSoundPath = join(dirname, '..', '..', '..', 'data', 'bonk.mp3');
  }

  execute(context: CommandContext): Promise<CommandResult> {
    const { user, args } = context;

    // Parse target from args (e.g., "!bonk @username")
    const target = args[1]?.replace(/^@/, '') || user.username;

    // Increment bonk count
    const currentCount = this.bonkCounts.get(target) || 0;
    const newCount = currentCount + 1;
    this.bonkCounts.set(target, newCount);

    // Generate response message
    const message =
      target === user.username
        ? `${user.username} bonked themselves! (Total: ${newCount})`
        : `${user.username} bonked ${target}! (Total: ${newCount})`;

    this.eventBus.emitSync<{ filePath: string }>('sound.play', {
      filePath: this.bonkSoundPath,
    });

    return Promise.resolve({
      success: true,
      message,
      data: {
        target,
        bonkCount: newCount,
        bonkedBy: user.username,
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
