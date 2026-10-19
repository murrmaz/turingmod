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
 * (OBS, the Arduino). It only times attempts; the integration still decides what failed and
 * whether it can be retried at all.
 */
export class ReconnectBackoff {
  private delayMs = INITIAL_DELAY_MS;
  private timer: NodeJS.Timeout | null = null;
  private connectedAt: number | null = null;

  /** Start over, for a fresh `start()`: no attempt pending, and the shortest delay next. */
  reset(): void {
    this.cancel();
    this.delayMs = INITIAL_DELAY_MS;
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
      this.delayMs = INITIAL_DELAY_MS;
    }
    this.connectedAt = null;
  }

  /** Run `attempt` after the current delay, and double the delay for next time. */
  schedule(attempt: () => void): number {
    this.cancel();
    const delayMs = this.delayMs;
    this.delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      attempt();
    }, delayMs);
    return delayMs;
  }

  /** Drop the pending attempt, if any. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
