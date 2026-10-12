import type { StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { type ChatMessageEvent, parseCommand } from '../platforms/chatMessage.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { formatElapsed } from '../utils/FormatHelpers.js';
import { Logger } from '../utils/Logger.js';

interface Lurker {
  since: number;
  /** What they said they were off to do; empty if nothing. */
  reason: string;
}

/** Who's lurking, per platform user. */
export interface LurkerKey {
  platform: StreamingPlatform;
  platformUserId: string;
}

/** The welcome-back line, as the original bot worded it. */
export function welcomeBackMessage(username: string, lurker: Lurker, now = Date.now()): string {
  const reason = lurker.reason === '' ? 'No Message Provided' : lurker.reason;
  return `Welcome back @${username}! You were gone for ${formatElapsed(now - lurker.since)} because of "${reason}"`;
}

/**
 * Keeps the lurk list for `!lurk`, `!unlurk` and `!leave`, in memory as the original did. A
 * lurker who chats again (anything but a command) is welcomed back automatically.
 */
@injectable()
@singleton()
export class LurkTracker {
  private lurkers = new Map<string, Lurker>();
  private subscribed = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'LurkTracker' });
  }

  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.eventBus.on<ChatMessageEvent>('chat.message', (event) => this.welcomeBack(event));
  }

  /** Start lurking. Resolves false if they already are. */
  lurk(user: LurkerKey, reason: string, now = Date.now()): boolean {
    const key = keyOf(user);
    if (this.lurkers.has(key)) return false;
    this.lurkers.set(key, { since: now, reason: reason.trim() });
    return true;
  }

  /** Stop lurking, returning how they were lurking, or null if they weren't. */
  unlurk(user: LurkerKey): Lurker | null {
    const key = keyOf(user);
    const lurker = this.lurkers.get(key) ?? null;
    this.lurkers.delete(key);
    return lurker;
  }

  /** Welcome a lurker back when they chat. Never rejects. */
  async welcomeBack(event: ChatMessageEvent): Promise<void> {
    if (parseCommand(event.message)) return;
    const lurker = this.unlurk(event);
    if (!lurker) return;
    try {
      await this.streamControl.sendChatMessage(
        event.platform,
        welcomeBackMessage(event.username, lurker)
      );
    } catch (error) {
      this.logger.warn(`Could not welcome back ${event.username}`, error);
    }
  }
}

function keyOf(user: LurkerKey): string {
  return `${user.platform}:${user.platformUserId}`;
}
