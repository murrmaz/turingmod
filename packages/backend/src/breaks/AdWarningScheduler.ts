import { IntegrationStatus, StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { formatCountdown } from '../utils/FormatHelpers.js';
import { Logger } from '../utils/Logger.js';
import { BreakService } from './BreakService.js';
import { renderMessage } from './breakSettings.js';

/** A re-read of the schedule only counts as "the ad moved" past this much drift. */
const SCHEDULE_TOLERANCE_MS = 5_000;
/** After an ad break, wait this long past its end before re-reading the schedule. */
const POST_BREAK_REPOLL_MS = 10_000;

/**
 * Warns chat on every platform ahead of Twitch's scheduled midrolls, at each configured lead
 * time (e.g. 5 minutes and 1 minute out).
 *
 * The schedule moves — snoozes push the next ad back, a manual ad resets the timer — so rather
 * than trusting one read, it re-reads the schedule periodically and again right before posting
 * each warning. A warning whose ad has moved is rescheduled instead of posted. Twitch is the
 * only platform with an ad schedule, but every platform loses the streamer during the break,
 * so the warnings go everywhere, worded per platform.
 */
@injectable()
@singleton()
export class AdWarningScheduler {
  private pollTimer: NodeJS.Timeout | null = null;
  private repollTimer: NodeJS.Timeout | null = null;
  private warningTimers: NodeJS.Timeout[] = [];
  /** The next-ad time (epoch ms) the current warning timers were scheduled against. */
  private scheduledFor: number | null = null;
  /** `${nextAdAt}:${leadSeconds}` for warnings already posted, so a re-read can't repeat one. */
  private posted = new Set<string>();
  private unsubscribers: (() => void)[] = [];
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private breakService: BreakService,
    private streamControl: StreamControlService,
    private platformRegistry: PlatformRegistry,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'AdWarningScheduler' });
  }

  start(): void {
    const intervalMs = this.breakService.getSettings().adWarnings.pollIntervalSeconds * 1000;
    this.pollTimer = setInterval(() => void this.poll(), intervalMs);

    this.unsubscribers.push(
      // The schedule only settles after the ad finishes; read it again then.
      this.eventBus.on('twitch.ad.break', (event) => {
        this.schedulePoll(event.durationSeconds * 1000 + POST_BREAK_REPOLL_MS);
      }),
      // Twitch going live, or its auth recovering, is the moment a schedule appears.
      this.eventBus.on('twitch.stream.online', () => this.schedulePoll(POST_BREAK_REPOLL_MS)),
      this.eventBus.on('integration.status', (event) => {
        if (event.name === 'twitch-api' && event.status === IntegrationStatus.CONNECTED) {
          this.schedulePoll(0);
        }
      })
    );

    void this.poll();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.repollTimer) {
      clearTimeout(this.repollTimer);
      this.repollTimer = null;
    }
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.clearWarnings();
  }

  /** Read the ad schedule and (re)arm warning timers for the next ad. */
  async poll(): Promise<void> {
    const nextAdAt = await this.readNextAdAt();
    if (nextAdAt === null) {
      this.clearWarnings();
      return;
    }
    this.scheduleWarnings(nextAdAt);
  }

  private schedulePoll(delayMs: number): void {
    if (this.repollTimer) {
      clearTimeout(this.repollTimer);
    }
    this.repollTimer = setTimeout(() => {
      this.repollTimer = null;
      void this.poll();
    }, delayMs);
  }

  /** Epoch ms of the next scheduled Twitch ad, or null if there's none or it can't be read. */
  private async readNextAdAt(): Promise<number | null> {
    if (!this.breakService.getSettings().enabled) {
      return null;
    }
    const twitch = this.platformRegistry.get(StreamingPlatform.TWITCH);
    if (!twitch || twitch.getUnavailableReason() !== null) {
      return null;
    }
    try {
      const adBreak = await this.streamControl.getNextAdBreak(StreamingPlatform.TWITCH);
      return adBreak?.nextAdDate?.getTime() ?? null;
    } catch (error) {
      this.logger.warn('Could not read the Twitch ad schedule', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private scheduleWarnings(nextAdAt: number): void {
    if (
      this.scheduledFor !== null &&
      Math.abs(this.scheduledFor - nextAdAt) <= SCHEDULE_TOLERANCE_MS
    ) {
      return; // Same ad as already scheduled; keep the existing timers.
    }

    this.clearWarnings();
    this.scheduledFor = nextAdAt;

    const now = Date.now();
    for (const leadSeconds of this.breakService.getSettings().adWarnings.leadTimesSeconds) {
      const delay = nextAdAt - leadSeconds * 1000 - now;
      if (delay < 0 || this.posted.has(this.key(nextAdAt, leadSeconds))) {
        continue; // That lead time has already passed, or was already announced.
      }
      this.warningTimers.push(setTimeout(() => void this.warn(nextAdAt, leadSeconds), delay));
    }
    this.logger.debug('Ad warnings scheduled', {
      nextAdAt: new Date(nextAdAt).toISOString(),
      warnings: this.warningTimers.length,
    });
  }

  private async warn(nextAdAt: number, leadSeconds: number): Promise<void> {
    // Confirm the ad hasn't moved since this timer was set (snooze, manual ad).
    const current = await this.readNextAdAt();
    if (current === null) {
      return;
    }
    if (Math.abs(current - nextAdAt) > SCHEDULE_TOLERANCE_MS) {
      this.logger.info('Next ad moved; rescheduling warnings', {
        from: new Date(nextAdAt).toISOString(),
        to: new Date(current).toISOString(),
      });
      this.scheduledFor = null;
      this.scheduleWarnings(current);
      return;
    }

    const key = this.key(nextAdAt, leadSeconds);
    if (this.posted.has(key)) {
      return;
    }
    this.posted.add(key);
    this.prunePosted();

    const time = formatCountdown(current - Date.now());
    const message = this.breakService.getSettings().messages.adWarning;
    try {
      const result = await this.streamControl.announce((platform) =>
        renderMessage(message, platform, { time })
      );
      for (const failure of result.failures) {
        this.logger.warn(`Could not post ad warning to ${failure.platform}`, {
          error: failure.error,
        });
      }
    } catch (error) {
      this.logger.error('Could not post ad warning', error);
    }
  }

  private clearWarnings(): void {
    for (const timer of this.warningTimers) {
      clearTimeout(timer);
    }
    this.warningTimers = [];
    this.scheduledFor = null;
  }

  /** Forget warnings for ads that are long past, so the set can't grow over a long stream. */
  private prunePosted(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const key of this.posted) {
      if (Number(key.split(':')[0]) < cutoff) {
        this.posted.delete(key);
      }
    }
  }

  private key(nextAdAt: number, leadSeconds: number): string {
    return `${nextAdAt}:${leadSeconds}`;
  }
}
