import 'reflect-metadata';
import { StreamingPlatform } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { chatMessage } from '../../platforms/testing.js';
import { Logger } from '../../utils/Logger.js';
import { LurkTracker, welcomeBackMessage } from './LurkTracker.js';

function setup() {
  const logger = new Logger({ level: 'silent' });
  const eventBus = new EventBus(logger);
  const sendChatMessage = vi.fn(() => Promise.resolve());
  const tracker = new LurkTracker(
    eventBus,
    { sendChatMessage } as unknown as StreamControlService,
    logger
  );
  tracker.start();
  return { eventBus, sendChatMessage, tracker };
}

const viewer = { platform: StreamingPlatform.TWITCH, platformUserId: 'viewer-id' };

describe('LurkTracker', () => {
  it('lurks once per viewer, per platform', () => {
    const { tracker } = setup();

    expect(tracker.lurk(viewer, 'dinner')).toBe(true);
    expect(tracker.lurk(viewer, 'again')).toBe(false);
    expect(tracker.lurk({ ...viewer, platform: StreamingPlatform.YOUTUBE }, '')).toBe(true);
  });

  it('welcomes a lurker back when they chat again, once', async () => {
    const { eventBus, sendChatMessage, tracker } = setup();
    tracker.lurk(viewer, 'making dinner', Date.now() - 65 * 60 * 1000);

    await eventBus.emit('chat.message', chatMessage("I'm back"));
    await eventBus.emit('chat.message', chatMessage('still here'));

    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    expect(sendChatMessage).toHaveBeenCalledWith(
      StreamingPlatform.TWITCH,
      expect.stringMatching(
        /^Welcome back @Viewer! You were gone for 1 hour and 5 minutes because of "making dinner"$/
      )
    );
  });

  it("doesn't treat a command as coming back", async () => {
    const { eventBus, sendChatMessage, tracker } = setup();
    tracker.lurk(viewer, '');

    await eventBus.emit('chat.message', chatMessage('!uptime'));

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(tracker.unlurk(viewer)).not.toBeNull();
  });

  it('fills in a missing reason the way the original did', () => {
    expect(welcomeBackMessage('Viewer', { since: 0, reason: '' }, 1000)).toBe(
      'Welcome back @Viewer! You were gone for 1 second because of "No Message Provided"'
    );
  });
});
