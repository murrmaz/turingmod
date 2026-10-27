import { describe, expect, it } from 'vitest';
import { PendingDeletes } from './pendingDeletes';

describe('PendingDeletes', () => {
  it('hides held ids until undone', () => {
    const pending = new PendingDeletes();
    const key = pending.hold([1, 2]);
    expect([...pending.hidden()]).toEqual([1, 2]);

    expect(pending.undo(key)).toBe(true);
    expect(pending.hidden().size).toBe(0);
    expect(pending.send(key)).toBeNull();
  });

  it('sends a batch once, keeps it hidden until settled, and refuses to undo it', () => {
    const pending = new PendingDeletes();
    const key = pending.hold([3]);

    expect(pending.send(key)).toEqual([3]);
    expect(pending.send(key)).toBeNull();
    expect(pending.undo(key)).toBe(false);
    expect([...pending.hidden()]).toEqual([3]);

    pending.settle(key);
    expect(pending.hidden().size).toBe(0);
  });

  it('keeps batches apart, and sendAll sends only those not yet sent', () => {
    const pending = new PendingDeletes();
    const first = pending.hold([1]);
    const second = pending.hold([2, 3]);
    const third = pending.hold([4]);
    pending.undo(second);
    pending.send(third);

    expect(pending.sendAll()).toEqual([{ key: first, ids: [1] }]);
    expect([...pending.hidden()].sort()).toEqual([1, 4]);
  });
});
