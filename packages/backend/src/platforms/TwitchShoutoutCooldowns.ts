import type { ShoutoutResult } from './interfaces/IStreamPlatform.js';

/** Twitch accepts one shoutout every 2 minutes, and one per target channel every 60 minutes. */
const GLOBAL_COOLDOWN_MS = 2 * 60 * 1000;
const TARGET_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Twitch's shoutout limits, tracked locally so TwitchPlatform can answer "not yet, retry in N"
 * instead of sending a call Twitch would reject. In memory only: after a restart the first
 * shoutout may be refused by Twitch itself, which surfaces as an ordinary API error.
 */
export class TwitchShoutoutCooldowns {
  private lastShoutoutAt: number | null = null;
  private readonly lastShoutoutAtByTarget = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The refusal to report if a shoutout to `targetId` would break a limit, otherwise null. */
  check(targetId: string): ShoutoutResult | null {
    const now = this.now();

    if (this.lastShoutoutAt !== null) {
      const sinceLast = now - this.lastShoutoutAt;
      if (sinceLast < GLOBAL_COOLDOWN_MS) {
        return {
          sent: false,
          reason: 'global_cooldown',
          retryAfterMs: GLOBAL_COOLDOWN_MS - sinceLast,
        };
      }
    }

    const lastForTarget = this.lastShoutoutAtByTarget.get(targetId);
    if (lastForTarget !== undefined) {
      const sinceTarget = now - lastForTarget;
      if (sinceTarget < TARGET_COOLDOWN_MS) {
        return {
          sent: false,
          reason: 'target_cooldown',
          retryAfterMs: TARGET_COOLDOWN_MS - sinceTarget,
        };
      }
    }

    return null;
  }

  /** Note a shoutout Twitch accepted. */
  record(targetId: string): void {
    const now = this.now();
    this.lastShoutoutAt = now;
    this.lastShoutoutAtByTarget.set(targetId, now);
  }
}
