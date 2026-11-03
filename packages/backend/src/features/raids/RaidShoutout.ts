import { StreamingPlatform } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import type { TwitchRaidEvent } from '../../core/events.js';
import {
  failureReporter,
  type IService,
  RepeatingFailures,
  Subscriptions,
} from '../../core/ServiceLifecycle.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';

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
@singleton()
export class RaidShoutout implements IService {
  private subscriptions = new Subscriptions();
  private logger: Logger;
  private failures: RepeatingFailures;

  constructor(
    private eventBus: EventBus,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'RaidShoutout' });
    this.failures = new RepeatingFailures(
      failureReporter(eventBus, this.logger, 'Raid shoutouts'),
      this.logger
    );
  }

  start(): void {
    this.subscriptions.add(this.eventBus.on('twitch.raid', (event) => this.onRaid(event)));
  }

  stop(): void {
    this.subscriptions.clear();
  }

  /** Never rejects: each failure is reported and the other half still runs. */
  async onRaid(event: TwitchRaidEvent): Promise<void> {
    const channel = event.fromBroadcasterName;
    this.logger.info(`${event.fromBroadcasterDisplayName} raided with ${event.viewers} viewer(s)`);

    try {
      await this.streamControl.sendChatMessage(
        StreamingPlatform.TWITCH,
        raidShoutoutMessage(channel)
      );
      this.failures.recovered('message');
    } catch (error) {
      this.failures.failed('message', `Could not post the raid shoutout for ${channel}.`, error);
    }

    try {
      const result = await this.streamControl
        .require(StreamingPlatform.TWITCH, 'shoutout')
        .shoutout(channel);
      this.failures.recovered('shoutout');
      if (!result.sent) {
        this.logger.info(
          `Twitch declined the shoutout for ${channel} (${result.reason ?? 'rate limited'}; ` +
            `retry in ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}s)`
        );
      }
    } catch (error) {
      this.failures.failed('shoutout', `Could not send Twitch's shoutout for ${channel}.`, error);
    }
  }
}
