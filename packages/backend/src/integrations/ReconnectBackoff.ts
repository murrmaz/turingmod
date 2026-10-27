/** Wait before the first reconnection attempt, doubling after each failure up to the maximum. */
const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS = 30_000;

/**
 * How long a connection must stay up before losing it starts the delays over. A connection that
 * drops sooner keeps backing off, so a peer that accepts and then drops at once (a board in a
 * brown-out reboot loop, or one that keeps kicking us for another client) isn't retried every
 * few seconds forever.
 */
const STABLE_AFTER_MS = 30_000;

/**
 * When to try reconnecting, for an integration that keeps a connection up while it is started
 * (OBS, the Arduino, YouTube's chat stream). It only times attempts and counts them; the
 * integration still decides what failed, whether it can be retried at all, when to give up, and
 * what counts as working again (`connected()`/`disconnected()` for a connection that must last,
 * `reset()` for anything else).
 */
export class ReconnectBackoff {
  private delayMs = INITIAL_DELAY_MS;
  private timer: NodeJS.Timeout | null = null;
  private connectedAt: number | null = null;
  private attemptCount = 0;

  /** Attempts scheduled since the delays last started over: for an integration that gives up. */
  get attempts(): number {
    return this.attemptCount;
  }

  /** Start over, for a fresh `start()`: no attempt pending, and the shortest delay next. */
  reset(): void {
    this.cancel();
    this.startOver();
    this.connectedAt = null;
  }

  /** A connection came up. */
  connected(): void {
    this.connectedAt = Date.now();
  }

  /**
   * A connection that was up has gone. If it had lasted, the next attempt starts over at the
   * shortest delay; otherwise it carries on backing off.
   */
  disconnected(): void {
    if (this.connectedAt !== null && Date.now() - this.connectedAt >= STABLE_AFTER_MS) {
      this.startOver();
    }
    this.connectedAt = null;
  }

  /** Run `attempt` after the current delay, and double the delay for next time. */
  schedule(attempt: () => void): number {
    this.cancel();
    const delayMs = this.delayMs;
    this.delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    this.attemptCount += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      attempt();
    }, delayMs);
    return delayMs;
  }

  /** The shortest delay next, and no attempts counted. */
  private startOver(): void {
    this.delayMs = INITIAL_DELAY_MS;
    this.attemptCount = 0;
  }

  /** Drop the pending attempt, if any. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
