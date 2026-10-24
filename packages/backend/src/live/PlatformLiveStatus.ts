import {
  createPlatformLiveStateMessage,
  messageOf,
  type PlatformLiveState,
  StreamingPlatform,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { PlatformLiveStateEvent } from '../core/events.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { WebSocketServer } from '../server/WebSocketServer.js';
import { Logger } from '../utils/Logger.js';

/**
 * Whether each platform is broadcasting and since when, for the console's header badges. Pushed
 * to the console on every change, and read by it on connect; going live or offline is also
 * published as `platform.liveState`.
 *
 * Event-driven, never polled: a platform is asked when it becomes usable, and again whenever it
 * signals a change (Twitch's stream.online/offline, YouTube chat finding or losing a broadcast).
 * Asking YouTube costs API quota, which is why nothing here asks it on a timer.
 */
@singleton()
export class PlatformLiveStatus implements IService {
  private subscriptions = new Subscriptions();
  private states = new Map<StreamingPlatform, PlatformLiveState>();
  /** Bumped per refresh, so an answer that arrives after a newer one is dropped. */
  private generations = new Map<StreamingPlatform, number>();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private registry: PlatformRegistry,
    private webSocketServer: WebSocketServer,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'PlatformLiveStatus' });
  }

  start(): void {
    for (const platform of this.registry.getAll()) {
      this.states.set(platform.platform, offline(platform.platform));
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
      this.eventBus.on('youtube.chat.state', ({ state }) => {
        // 'resolving' is still looking, so it says nothing yet either way.
        return state === 'resolving' ? Promise.resolve() : this.refresh(StreamingPlatform.YOUTUBE);
      })
    );
  }

  stop(): void {
    this.subscriptions.clear();
  }

  /** Every platform's current state, in registry order. */
  getStates(): PlatformLiveState[] {
    return [...this.states.values()];
  }

  /** Ask a platform whether it's live. Resolves once the answer is recorded; never rejects. */
  async refresh(platform: StreamingPlatform): Promise<void> {
    const facade = this.registry.get(platform);
    if (!facade) {
      return;
    }
    const generation = this.bump(platform);
    if (facade.getUnavailableReason() !== null) {
      this.set(offline(platform), 'unavailable');
      return;
    }

    try {
      const uptime = await facade.getUptime();
      // A live broadcast may not have reported a start time yet, which reads as no uptime.
      const live = uptime !== null || (await facade.isLive());
      if (this.generations.get(platform) !== generation) {
        return;
      }
      this.set({ platform, live, startedAt: uptime === null ? null : Date.now() - uptime });
    } catch (error) {
      this.logger.warn('Could not read whether a platform is live', {
        platform,
        error: messageOf(error),
      });
    }
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
    this.webSocketServer.broadcast(createPlatformLiveStateMessage(this.getStates()));
    if (current?.live !== state.live) {
      void this.eventBus.emit('platform.liveState', { ...state, cause });
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
