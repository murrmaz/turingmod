import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouterOutputs } from '@/context/trpc-context';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { switchableConnection } from '@/testing/render-console';
import { useSubscription } from './useSubscription';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

type Suggestion = RouterOutputs['suggestions']['delete'][number];

const TITLE = "Couldn't read suggestions";
const NONE: Suggestion[] = [];
const idea = (id: number): Suggestion => ({
  id,
  suggestion: `idea ${id}`,
  suggestedBy: null,
  createdAt: id,
});

function setup() {
  const watch = new FakeSubscription<Suggestion[]>();
  const subscribe = vi.spyOn(watch, 'subscribe');
  const connection = switchableConnection({ suggestions: { watch } });
  return { watch, subscribe, ...connection };
}

describe('useSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts from the initial value, and each value replaces the last', () => {
    const { watch, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );
    expect(result.current[0]).toEqual([]);

    watch.emit([idea(1)]);
    watch.emit([idea(2)]);

    expect(result.current[0]).toEqual([idea(2)]);
  });

  it('shows a value from elsewhere until the next one arrives', () => {
    const { watch, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );

    act(() => result.current[1]([idea(5)]));
    expect(result.current[0]).toEqual([idea(5)]);

    watch.emit([idea(6)]);
    expect(result.current[0]).toEqual([idea(6)]);
  });

  it('subscribes once, though each render passes new functions', () => {
    const { subscribe, wrapper } = setup();
    const { rerender } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );

    rerender();
    rerender();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('applies each event with the reduce of the latest render', () => {
    const { watch, subscribe, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ step }) =>
        useSubscription(
          (trpc, on) => trpc.suggestions.watch.subscribe(undefined, on),
          0,
          TITLE,
          (count: number) => count + step
        ),
      { wrapper, initialProps: { step: 1 } }
    );

    watch.emit([]);
    expect(result.current[0]).toBe(1);

    rerender({ step: 10 });
    watch.emit([]);

    expect(result.current[0]).toBe(11);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('moves to a new client, leaving the old one', () => {
    const { watch, wrapper, switchClient } = setup();
    const { result, rerender } = renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );
    const next = new FakeSubscription<Suggestion[]>();

    switchClient({ suggestions: { watch: next } });
    rerender();
    watch.emit([idea(1)]);
    expect(result.current[0]).toEqual([]);

    next.emit([idea(2)]);
    expect(result.current[0]).toEqual([idea(2)]);
  });

  it('stops listening once unmounted', () => {
    const { watch, wrapper } = setup();
    const unsubscribed = vi.fn();
    const { unmount } = renderHook(
      () =>
        useSubscription(
          (trpc, on) => {
            const subscription = trpc.suggestions.watch.subscribe(undefined, on);
            return {
              unsubscribe: () => {
                unsubscribed();
                subscription.unsubscribe();
              },
            };
          },
          NONE,
          TITLE
        ),
      { wrapper }
    );

    unmount();

    expect(unsubscribed).toHaveBeenCalledTimes(1);
    watch.emit([idea(1)]);
  });

  it('reports a failed subscription under its title', () => {
    const { watch, wrapper } = setup();
    renderHook(
      () =>
        useSubscription((trpc, on) => trpc.suggestions.watch.subscribe(undefined, on), NONE, TITLE),
      { wrapper }
    );

    watch.fail(new Error('Stream lost'));

    expect(toast.error).toHaveBeenCalledWith(TITLE, { id: TITLE, description: 'Stream lost' });
  });
});
