import 'reflect-metadata';
import { PermissionLevel } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import type { TwitchApiIntegration } from './TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';
import { permissionFromBadges, TwitchEventSubIntegration } from './TwitchEventSubIntegration.js';

const listener = vi.hoisted(() => ({
  onSocketReady: null as ((userId: string, sessionId: string) => void) | null,
}));

vi.mock('@twurple/eventsub-ws', () => ({
  // Every on<Topic>() is a subscription this test has no use for.
  // biome-ignore lint/style/useNamingConvention: the name of the class being replaced
  EventSubWsListener: class {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: a stand-in for Twurple's many topics
      return new Proxy(this, {
        get: (_target, method: string) => {
          if (method === 'onUserSocketReady') {
            return (handler: (userId: string, sessionId: string) => void) => {
              listener.onSocketReady = handler;
            };
          }
          return vi.fn(async () => undefined);
        },
      });
    }
  },
}));

describe('TwitchEventSubIntegration', () => {
  beforeEach(() => {
    listener.onSocketReady = null;
  });

  it('says when the socket is ready, since Twitch resends nothing it sent while down', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const ready = vi.fn();
    eventBus.on('twitch.eventSub.ready', ready);
    const integration = new TwitchEventSubIntegration(
      eventBus,
      new Logger({ level: 'silent' }),
      {
        getAuthProvider: () => ({}),
        getAuthenticatedUserId: () => '1',
      } as unknown as TwitchAuthIntegration,
      {
        getApiClient: () => ({}),
        request: async () => ({ id: '1', displayName: 'B' }),
      } as unknown as TwitchApiIntegration
    );

    await integration.start();
    listener.onSocketReady?.('1', 'session');

    expect(ready).toHaveBeenCalledWith({ sessionId: 'session' });
  });
});

describe('permissionFromBadges', () => {
  it('treats a lead moderator as a moderator', () => {
    expect(permissionFromBadges(['lead_moderator', 'subscriber'])).toBe(PermissionLevel.MODERATOR);
  });

  it('treats a founder as a subscriber', () => {
    expect(permissionFromBadges(['founder'])).toBe(PermissionLevel.SUBSCRIBER);
  });

  it('takes the highest role among the badges', () => {
    expect(permissionFromBadges(['subscriber', 'vip'])).toBe(PermissionLevel.VIP);
    expect(permissionFromBadges(['glhf-pledge'])).toBe(PermissionLevel.VIEWER);
  });
});
