/**
 * Deletes held back so they can be undone: each `hold()` is a batch of ids, hidden from view at
 * once and sent only when its Undo lapses. A batch stays hidden while it's being sent, so a row
 * doesn't flash back in before the backend's answer, and is forgotten once that answer arrives.
 */
export class PendingDeletes {
  private readonly batches = new Map<string, { ids: readonly number[]; sending: boolean }>();
  private next = 0;

  /** Hold these ids back; returns the batch's key. */
  hold(ids: readonly number[]): string {
    const key = `delete-${++this.next}`;
    this.batches.set(key, { ids, sending: false });
    return key;
  }

  /** Undo a batch not yet sent; false if it already was (or is unknown). */
  undo(key: string): boolean {
    const batch = this.batches.get(key);
    if (!batch || batch.sending) {
      return false;
    }
    this.batches.delete(key);
    return true;
  }

  /** The ids to send for a batch, marking it sent; null if it was undone or already sent. */
  send(key: string): readonly number[] | null {
    const batch = this.batches.get(key);
    if (!batch || batch.sending) {
      return null;
    }
    batch.sending = true;
    return batch.ids;
  }

  /** Every batch not yet sent, marked sent. */
  sendAll(): { key: string; ids: readonly number[] }[] {
    return [...this.batches.keys()].flatMap((key) => {
      const ids = this.send(key);
      return ids ? [{ key, ids }] : [];
    });
  }

  /** Forget a batch once its send has been answered, whether it succeeded or failed. */
  settle(key: string): void {
    this.batches.delete(key);
  }

  /** Every id hidden from view: held, or sent and not yet answered. */
  hidden(): ReadonlySet<number> {
    return new Set([...this.batches.values()].flatMap((batch) => batch.ids));
  }
}
