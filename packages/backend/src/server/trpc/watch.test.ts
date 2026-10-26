import { describe, expect, it } from 'vitest';
import { events, watch } from './watch.js';

/** A value and a way to announce that it changed, as an event bus subscription would. */
function changingValue(initial: number) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    set: (next: number) => {
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    listenerCount: () => listeners.size,
  };
}

describe('watch', () => {
  it('sends the current value, then the value after each change', async () => {
    const source = changingValue(1);
    const controller = new AbortController();
    const values = watch(source.read, source.subscribe, controller.signal);

    expect((await values.next()).value).toBe(1);
    const next = values.next();
    source.set(2);
    expect((await next).value).toBe(2);
    controller.abort();
  });

  it('collapses changes made while a value was being sent into one read of the latest', async () => {
    const source = changingValue(1);
    const controller = new AbortController();
    const values = watch(source.read, source.subscribe, controller.signal);

    await values.next();
    source.set(2);
    source.set(3);

    expect((await values.next()).value).toBe(3);
    controller.abort();
  });

  it('ends while waiting for a change once aborted, and unsubscribes', async () => {
    const source = changingValue(1);
    const controller = new AbortController();
    const values = watch(source.read, source.subscribe, controller.signal);

    await values.next();
    const next = values.next();
    controller.abort();

    expect(await next).toEqual({ done: true, value: undefined });
    expect(source.listenerCount()).toBe(0);
  });
});

/** An event source, as an event bus subscription would be. */
function eventSource<T>() {
  const listeners = new Set<(event: T) => void>();
  return {
    emit: (event: T) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe: (onEvent: (event: T) => void) => {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    listenerCount: () => listeners.size,
  };
}

describe('events', () => {
  it('subscribes at once, so events before the first read are kept, in order', async () => {
    const source = eventSource<number>();
    const controller = new AbortController();
    const stream = events(source.subscribe, controller.signal);

    source.emit(1);
    source.emit(2);

    expect((await stream.next()).value).toBe(1);
    expect((await stream.next()).value).toBe(2);
    controller.abort();
  });

  it('waits for the next event when none is queued', async () => {
    const source = eventSource<string>();
    const controller = new AbortController();
    const stream = events(source.subscribe, controller.signal);

    const next = stream.next();
    source.emit('raid');

    expect(await next).toEqual({ value: 'raid', done: false });
    controller.abort();
  });

  it('ends while waiting once aborted, and unsubscribes', async () => {
    const source = eventSource<number>();
    const controller = new AbortController();
    const stream = events(source.subscribe, controller.signal);

    const next = stream.next();
    controller.abort();

    expect(await next).toEqual({ value: undefined, done: true });
    expect(source.listenerCount()).toBe(0);
  });

  it('unsubscribes when returned without ever being read', async () => {
    const source = eventSource<number>();
    const stream = events(source.subscribe, undefined);

    await stream.return?.();

    expect(source.listenerCount()).toBe(0);
  });
});
