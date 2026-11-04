import { type PlatformLiveState, platformDisplayName, StreamingPlatform } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import type { PlatformLiveStateEvent } from '../../core/events.js';
import {
  type IService,
  type RepeatingFailures,
  repeatingFailures,
  Subscriptions,
} from '../../core/ServiceLifecycle.js';
import { StreamControlService } from '../../platforms/StreamControlService.js';
import { Logger } from '../../utils/Logger.js';
import { ObsStreamState } from './ObsStreamState.js';

const MINUTE_MS = 60_000;
/**
 * The waits between asks about a platform that reads live with no stream behind it, about an hour
 * in all. A platform can go on reporting a stream for a while after the output stops, so one answer
 * isn't enough. It's bounded because asking YouTube costs API quota, and because a platform can
 * really be live without OBS.
 */
const RECHECK_DELAYS_MS = [1, 2, 4, 8, 16, 32].map((minutes) => minutes * MINUTE_MS);

/**
 * Whether each platform is broadcasting and since when, for the console's header badges, which
 * follow it through `platform.liveState.changed` and the `liveState.watch` subscription; going live
 * or offline is also published as `platform.liveState`.
 *
 * Event-driven, never polled while a stream is going out: a platform is asked when it becomes
 * usable, and again whenever it signals a change (Twitch's stream.online/offline and EventSub's
 * socket coming back, YouTube chat finding or losing a broadcast).
 *
 * A signal can be missed or answered too early, and a platform stuck reading live never posts
 * "was live for" or announces the next stream. So when a platform reads live with no sign of a
 * stream behind it (OBS stopped or isn't streaming, or chat went idle), it's asked again on
 * RECHECK_DELAYS_MS until it reads offline.
 */
@singleton()
export class PlatformLiveStatus implements IService {
  private subscriptions = new Subscriptions();
  private states = new Map<StreamingPlatform, PlatformLiveState>();
  /** Bumped per refresh, so an answer that arrives after a newer one is dropped. */
  private generations = new Map<StreamingPlatform, number>();
  /** Set from the first wait until the asking is over, including while an answer is awaited. */
  private recheckTimer: NodeJS.Timeout | null = null;
  private logger: Logger;
  /** By platform, since a recheck asks again while its outage lasts. */
  private failures: RepeatingFailures;

  constructor(
    private eventBus: EventBus,
    private streamControl: StreamControlService,
    private obsStream: ObsStreamState,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'PlatformLiveStatus' });
    this.failures = repeatingFailures(eventBus, this.logger, 'Live status');
  }

  start(): void {
    for (const platform of this.streamControl.platforms()) {
      this.states.set(platform, offline(platform));
    }
    this.subscriptions.add(
      this.eventBus.on('platform.availability', ({ platform, available }) => {
        if (available) {
          return this.refresh(platform);
        }
        // Bumped, so a refresh still in flight can't bring back a live answer from before.
        this.bump(platform);
        this.set(offline(platform), 'unavailable');
        return Promise.resolve();
      }),
      this.eventBus.on('twitch.stream.online', ({ startedAt }) => {
        this.bump(StreamingPlatform.TWITCH);
        this.set({
          platform: StreamingPlatform.TWITCH,
          live: true,
          startedAt: startedAt.getTime(),
        });
      }),
      this.eventBus.on('twitch.stream.offline', () => {
        this.bump(StreamingPlatform.TWITCH);
        this.set(offline(StreamingPlatform.TWITCH));
      }),
      this.eventBus.on('twitch.eventSub.ready', () => this.refresh(StreamingPlatform.TWITCH)),
      this.eventBus.on('youtube.chat.state', async ({ state }) => {
        // 'resolving' is still looking, so it says nothing yet either way.
        if (state === 'resolving') {
          return;
        }
        await this.refresh(StreamingPlatform.YOUTUBE);
        if (state === 'idle') {
          this.startRechecks();
        }
      }),
      this.eventBus.on('stream.output.changed', ({ streaming }) => {
        if (streaming) {
          this.cancelRechecks();
        } else {
          this.startRechecks();
        }
      })
    );
  }

  stop(): void {
    this.subscriptions.clear();
    this.cancelRechecks();
  }

  /** Every platform's current state, in registry order. */
  getStates(): PlatformLiveState[] {
    return [...this.states.values()];
  }

  /** Ask a platform whether it's live. Resolves once the answer is recorded; never rejects. */
  async refresh(platform: StreamingPlatform): Promise<void> {
    const generation = this.bump(platform);
    if (this.streamControl.getUnavailableReason(platform) !== null) {
      this.set(offline(platform), 'unavailable');
      return;
    }

    try {
      const broadcast = await this.streamControl.getLiveBroadcast(platform);
      if (this.generations.get(platform) !== generation) {
        return;
      }
      this.failures.recovered(platform);
      this.set({
        platform,
        live: broadcast !== null,
        startedAt: broadcast?.startedAt?.getTime() ?? null,
      });
    } catch (error) {
      // A newer answer, or the platform becoming unavailable, already replaced this one.
      if (this.generations.get(platform) !== generation) {
        this.logger.debug('A superseded read of whether a platform is live failed', { error });
        return;
      }
      this.failures.failed(
        platform,
        `Could not read whether ${platformDisplayName(platform)} is live, so the header and the ` +
          'go-live post may be out of date until it next reports a change.',
        error
      );
    }
  }

  /** Ask again from the first wait, if anything reads live. */
  private startRechecks(): void {
    this.cancelRechecks();
    if (this.livePlatforms().length > 0) {
      this.scheduleRecheck(0);
    }
  }

  private cancelRechecks(): void {
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
  }

  private scheduleRecheck(attempt: number): void {
    const delay = RECHECK_DELAYS_MS[attempt];
    if (delay === undefined) {
      this.recheckTimer = null;
      this.logger.warn('A platform still reports a stream with none going out; no longer asking', {
        platforms: this.livePlatforms(),
      });
      return;
    }
    this.recheckTimer = setTimeout(() => void this.recheck(attempt), delay);
  }

  private async recheck(attempt: number): Promise<void> {
    const timer = this.recheckTimer;
    await Promise.all(this.livePlatforms().map((platform) => this.refresh(platform)));
    if (this.recheckTimer !== timer) {
      return; // cancelled or started over while asking
    }
    if (this.livePlatforms().length > 0) {
      this.scheduleRecheck(attempt + 1);
    } else {
      this.recheckTimer = null;
    }
  }

  private livePlatforms(): StreamingPlatform[] {
    return this.getStates()
      .filter((state) => state.live)
      .map((state) => state.platform);
  }

  private bump(platform: StreamingPlatform): number {
    const next = (this.generations.get(platform) ?? 0) + 1;
    this.generations.set(platform, next);
    return next;
  }

  private set(state: PlatformLiveState, cause: PlatformLiveStateEvent['cause'] = 'reported'): void {
    const current = this.states.get(state.platform);
    if (current && current.live === state.live && sameStart(current, state)) {
      return;
    }
    this.states.set(state.platform, state);
    this.eventBus.emitSync('platform.liveState.changed', undefined);
    if (current?.live !== state.live) {
      this.eventBus.emitSync('platform.liveState', { ...state, cause });
      if (state.live && !this.obsStream.isStreaming()) {
        this.startRechecks();
      }
    }
  }
}

function offline(platform: StreamingPlatform): PlatformLiveState {
  return { platform, live: false, startedAt: null };
}

/**
 * Uptime-derived start times drift by however long the request took, so within a few seconds
 * counts as the same start rather than a change worth pushing.
 */
function sameStart(a: PlatformLiveState, b: PlatformLiveState): boolean {
  if (a.startedAt === null || b.startedAt === null) {
    return a.startedAt === b.startedAt;
  }
  return Math.abs(a.startedAt - b.startedAt) < 5000;
}
