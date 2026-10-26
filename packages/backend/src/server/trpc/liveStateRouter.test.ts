import { type PlatformLiveState, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import type { PlatformLiveStatus } from '../../live/PlatformLiveStatus.js';
import { createLiveStateRouter } from './liveStateRouter.js';
import { createCallerFactory } from './trpc.js';

describe('liveState router', () => {
  it("sends every platform's state on subscribing and again on each change", async () => {
    let states: PlatformLiveState[] = [
      { platform: StreamingPlatform.TWITCH, live: false, startedAt: null },
    ];
    const listeners = new Set<() => void>();
    const liveStatus = {
      getStates: () => states,
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const controller = new AbortController();
    const caller = createCallerFactory(
      createLiveStateRouter(liveStatus as unknown as PlatformLiveStatus)
    )({ consoleOrigin: null }, { signal: controller.signal });
    const updates = (await caller.watch())[Symbol.asyncIterator]();
    expect((await updates.next()).value).toEqual(states);

    const next = updates.next();
    states = [{ platform: StreamingPlatform.TWITCH, live: true, startedAt: 1000 }];
    for (const listener of listeners) {
      listener();
    }

    expect((await next).value).toEqual(states);
    controller.abort();
  });
});
