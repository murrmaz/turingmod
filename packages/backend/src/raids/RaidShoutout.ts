import { StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { TwitchRaidEvent } from '../core/events.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';

/** The chat message posted when a channel raids, carried over from the original bot. */
export function raidShoutoutMessage(channelName: string): string {
  return `Please check out and follow this cool dude here! https://www.twitch.tv/${channelName}`;
}

/**
 * Shouts out a channel that raids in: a chat message linking the raider's channel, plus
 * Twitch's native shoutout.
 *
 * The two are independent and best-effort. Twitch rate-limits native shoutouts (once per two
 * minutes, and once per hour per channel), so back-to-back raids still each get the chat
 * message even when the native shoutout is declined.
 */
@injectable()
@singleton()
export class RaidShoutout {
  private subscribed = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'RaidShoutout' });
  }

  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.eventBus.on('twitch.raid', (event) => this.onRaid(event));
  }

  /** Never rejects: each failure is logged and the other half still runs. */
  async onRaid(event: TwitchRaidEvent): Promise<void> {
    const channel = event.fromBroadcasterName;
    this.logger.info(`${event.fromBroadcasterDisplayName} raided with ${event.viewers} viewer(s)`);

    try {
      await this.streamControl.sendChatMessage(
        StreamingPlatform.TWITCH,
        raidShoutoutMessage(channel)
      );
    } catch (error) {
      this.logger.error(`Failed to post the raid shoutout message for ${channel}`, error);
    }

    try {
      const result = await this.streamControl.shoutout(StreamingPlatform.TWITCH, channel);
      if (!result.sent) {
        this.logger.info(
          `Twitch declined the shoutout for ${channel} (${result.reason ?? 'rate limited'}; ` +
            `retry in ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}s)`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send the native shoutout for ${channel}`, error);
    }
  }
}
