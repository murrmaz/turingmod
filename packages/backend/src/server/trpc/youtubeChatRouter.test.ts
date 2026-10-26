import 'reflect-metadata';
import type { YouTubeChatState } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { Logger } from '../../utils/Logger.js';
import { createCallerFactory } from './trpc.js';
import { createYouTubeChatRouter } from './youtubeChatRouter.js';

const logger = new Logger({ level: 'silent' });

function setup(running: boolean) {
  const eventBus = new EventBus(logger);
  let state: YouTubeChatState = 'idle';
  const integration = {
    isRunning: () => running,
    getState: () => state,
    connectChat: vi.fn(() => {
      state = 'resolving';
      void eventBus.emit('youtube.chat.state', { state });
    }),
    disconnectChat: vi.fn(() => {
      state = 'idle';
      void eventBus.emit('youtube.chat.state', { state });
    }),
  };
  const controller = new AbortController();
  const caller = createCallerFactory(
    createYouTubeChatRouter(integration as unknown as YouTubeChatIntegration, eventBus, logger)
  )({}, { signal: controller.signal });
  return { caller, controller, integration };
}

describe('youtubeChat router', () => {
  it('connects chat and answers with the new state when the integration is running', async () => {
    const { caller, integration } = setup(true);

    expect(await caller.goLive()).toBe('resolving');
    expect(integration.connectChat).toHaveBeenCalledWith('console');
  });

  it("refuses to go live when the integration isn't running, so the console isn't told it worked", async () => {
    const { caller, integration } = setup(false);

    await expect(caller.goLive()).rejects.toThrow("youtube-chat isn't running");
    expect(integration.connectChat).not.toHaveBeenCalled();
  });

  it('sends the state on subscribing and on every transition', async () => {
    const { caller, controller } = setup(true);
    const states = (await caller.watch())[Symbol.asyncIterator]();
    expect((await states.next()).value).toBe('idle');

    const next = states.next();
    await caller.goLive();

    expect((await next).value).toBe('resolving');
    controller.abort();
  });
});
