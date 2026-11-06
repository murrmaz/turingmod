import { type PlatformLiveState, StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { PlatformLiveStatus } from '../../features/live/PlatformLiveStatus.js';
import { fake } from '../../testing.js';
import { Logger } from '../../utils/Logger.js';
import { createLiveStateRouter } from './liveStateRouter.js';
import { createCallerFactory } from './trpc.js';

describe('liveState router', () => {
  it("sends every platform's state on subscribing and again on each change", async () => {
    let states: PlatformLiveState[] = [
      { platform: StreamingPlatform.TWITCH, live: false, startedAt: null },
    ];
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const liveStatus = { getStates: () => states };
    const controller = new AbortController();
    const caller = createCallerFactory(
      createLiveStateRouter(fake<PlatformLiveStatus>()(liveStatus), eventBus)
    )({ consoleOrigin: null }, { signal: controller.signal });
    const updates = (await caller.watch())[Symbol.asyncIterator]();
    expect((await updates.next()).value).toEqual(states);

    const next = updates.next();
    states = [{ platform: StreamingPlatform.TWITCH, live: true, startedAt: 1000 }];
    eventBus.emitSync('platform.liveState.changed', undefined);

    expect((await next).value).toEqual(states);
    controller.abort();
  });
});
