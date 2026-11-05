import 'reflect-metadata';
import { IntegrationStatus, PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import type { EventMap } from '../../../core/events.js';
import { Logger } from '../../../utils/Logger.js';
import type { TwitchApiIntegration } from './TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';
import { permissionFromBadges, TwitchEventSubIntegration } from './TwitchEventSubIntegration.js';

const twurple = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  /** Stands in for Twurple's listener: on<Anything>() keeps the handler, others do nothing. */
  const createListener = () => {
    const handlers = new Map<string, Handler>();
    const stop = vi.fn();
    const listener = new Proxy(
      {},
      {
        get: (_target, method: string) => {
          if (method === 'stop') {
            return stop;
          }
          if (!method.startsWith('on')) {
            return () => undefined;
          }
          return (...args: unknown[]) => {
            handlers.set(method, args.at(-1) as Handler);
            return { id: method };
          };
        },
      }
    );
    return { handlers, stop, listener };
  };
  return { createListener, listeners: [] as ReturnType<typeof createListener>[] };
});

vi.mock('@twurple/eventsub-ws', () => ({
  // biome-ignore lint/style/useNamingConvention: mirrors the exported class name.
  EventSubWsListener: class {
    constructor() {
      const fake = twurple.createListener();
      twurple.listeners.push(fake);
      // biome-ignore lint/correctness/noConstructorReturn: a stand-in for Twurple's many topics
      return fake.listener;
    }
  },
}));

/** The methods that subscribe to a topic with DEFAULT_EVENTSUB_TOPICS. */
const DEFAULT_TOPIC_METHODS = [
  'onChannelChatMessage',
  'onChannelFollow',
  'onChannelSubscription',
  'onChannelRaidTo',
  'onStreamOnline',
  'onStreamOffline',
  'onChannelUpdate',
  'onChannelAdBreakBegin',
  'onChannelRedemptionAdd',
];

describe('TwitchEventSubIntegration', () => {
  let eventBus: EventBus;
  let integration: TwitchEventSubIntegration;
  let auth: {
    getAuthProvider: () => object;
    getAuthenticatedUserId: () => string;
    markAuthRequired: ReturnType<typeof vi.fn>;
  };
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    twurple.listeners.length = 0;
    auth = {
      getAuthProvider: () => ({}),
      getAuthenticatedUserId: () => '1',
      markAuthRequired: vi.fn(),
    };
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    request = vi.fn(async () => ({ id: '1', displayName: 'B' }));
    integration = new TwitchEventSubIntegration(
      eventBus,
      new Logger({ level: 'silent' }),
      auth as unknown as TwitchAuthIntegration,
      { getApiClient: () => ({}), request } as unknown as TwitchApiIntegration
    );
  });

  const current = () => {
    const fake = twurple.listeners.at(-1);
    if (!fake) {
      throw new Error('No listener was created');
    }
    return fake;
  };
  const fire = (method: string, ...args: unknown[]) => {
    const handler = current().handlers.get(method);
    if (!handler) {
      throw new Error(`Nothing subscribed through ${method}`);
    }
    handler(...args);
  };
  const accepted = (method: string) => fire('onSubscriptionCreateSuccess', { id: method });
  const refused = (method: string, message: string) =>
    fire('onSubscriptionCreateFailure', { id: method }, new Error(message));
  const acceptAll = () => {
    for (const method of DEFAULT_TOPIC_METHODS) {
      accepted(method);
    }
  };

  describe('status', () => {
    it('is still connecting once started, before Twitch has answered', async () => {
      await integration.start();

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    });

    it('stays connecting while any topic is unanswered', async () => {
      await integration.start();

      for (const method of DEFAULT_TOPIC_METHODS.slice(1)) {
        accepted(method);
      }

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    });

    it('is connected once Twitch has accepted every topic', async () => {
      await integration.start();

      acceptAll();

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    it('is connected at once with every topic turned off', async () => {
      await integration.initialize({
        subscriptions: {
          channelChatMessage: false,
          channelFollow: false,
          channelSubscribe: false,
          channelRaid: false,
          streamOnline: false,
          streamOffline: false,
          channelUpdate: false,
          adBreakBegin: false,
          channelPointRedemption: false,
        },
      });

      await integration.start();

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    it('is an error naming what was refused, and why', async () => {
      await integration.start();

      for (const method of DEFAULT_TOPIC_METHODS.slice(2)) {
        accepted(method);
      }
      accepted('onChannelFollow');
      refused('onChannelChatMessage', 'Forbidden');

      expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
      expect(integration.getErrorMessage()).toContain('channel.chat.message: Forbidden');
      expect(integration.getErrorMessage()).not.toContain('channel.follow');
    });

    it('reports a refusal without waiting for the other topics', async () => {
      await integration.start();

      refused('onChannelFollow', 'Forbidden');

      expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    });

    it('adds later refusals to the error, and an acceptance does not clear it', async () => {
      await integration.start();
      refused('onChannelFollow', 'Forbidden');

      refused('onChannelRaidTo', 'Forbidden');
      accepted('onChannelChatMessage');

      expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
      expect(integration.getErrorMessage()).toContain('channel.follow, channel.raid: Forbidden');
    });

    it('groups topics refused for the same reason', async () => {
      await integration.start();

      for (const method of DEFAULT_TOPIC_METHODS.slice(3)) {
        accepted(method);
      }
      refused('onChannelChatMessage', 'Forbidden');
      refused('onChannelFollow', 'Forbidden');
      refused('onChannelSubscription', 'Too many');

      const message = integration.getErrorMessage();
      expect(message).toContain('channel.chat.message, channel.follow: Forbidden');
      expect(message).toContain('channel.subscribe: Too many');
    });

    it('goes back to connecting when the socket drops', async () => {
      await integration.start();
      acceptAll();

      fire('onUserSocketDisconnect', '1', new Error('gone'));

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
      expect(integration.getErrorMessage()).toContain('reconnecting');
    });

    it('announces a dropped socket once, however many attempts to reconnect fail', async () => {
      await integration.start();
      acceptAll();
      const statuses = vi.fn();
      integration.on('status', statuses);

      fire('onUserSocketDisconnect', '1', new Error('gone'));
      fire('onUserSocketDisconnect', '1', new Error('still gone'));
      fire('onUserSocketDisconnect', '1', new Error('still gone'));

      expect(statuses).toHaveBeenCalledTimes(1);
    });

    it('is connected again once Twitch has accepted every topic on the new socket', async () => {
      await integration.start();
      acceptAll();
      fire('onUserSocketDisconnect', '1', new Error('gone'));

      for (const method of DEFAULT_TOPIC_METHODS.slice(1)) {
        accepted(method);
      }
      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);

      accepted(DEFAULT_TOPIC_METHODS[0] ?? '');
      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    it('recovers from a refusal when a new socket subscribes again', async () => {
      await integration.start();
      for (const method of DEFAULT_TOPIC_METHODS.slice(1)) {
        accepted(method);
      }
      refused('onChannelChatMessage', 'Unavailable');
      expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);

      fire('onUserSocketDisconnect', '1', new Error('gone'));
      acceptAll();

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    it('tells the auth integration when Twitch revokes the grant', async () => {
      await integration.start();

      fire('onRevoke', { id: 'onChannelFollow' }, 'authorization_revoked');

      expect(auth.markAuthRequired).toHaveBeenCalledWith(
        'Twitch revoked authorization — re-authorization required'
      );
    });

    it('says nothing about the grant when a subscription is revoked for another reason', async () => {
      await integration.start();

      fire('onRevoke', { id: 'onChannelFollow' }, 'moderator_removed');

      expect(auth.markAuthRequired).not.toHaveBeenCalled();
    });

    it('is an error when the broadcaster cannot be looked up', async () => {
      request.mockRejectedValue(new Error('Helix is down'));

      await expect(integration.start()).rejects.toThrow('Helix is down');

      expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    });
  });

  describe('restarting', () => {
    it('closes the old listener on a retry, so events are not delivered twice', async () => {
      await integration.start();
      const first = current();

      await integration.start();

      expect(first.stop).toHaveBeenCalledOnce();
      expect(twurple.listeners).toHaveLength(2);
    });

    it('ignores a revoke or a socket opening on a listener it has moved on from', async () => {
      await integration.start();
      const first = current();
      await integration.start();
      const ready = vi.fn();
      eventBus.on('twitch.eventSub.ready', ready);

      first.handlers.get('onRevoke')?.({ id: 'onChannelFollow' }, 'authorization_revoked');
      first.handlers.get('onUserSocketReady')?.('1', 'session');

      expect(auth.markAuthRequired).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
    });

    it('ignores a late answer from a listener it has moved on from', async () => {
      await integration.start();
      const first = current();

      await integration.start();
      first.handlers.get('onSubscriptionCreateFailure')?.(
        { id: 'onChannelFollow' },
        new Error('late')
      );
      acceptAll();

      expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    });

    describe('a start still looking up the broadcaster', () => {
      // IntegrationManager gives up on a start after its timeout and releases the integration, so
      // a stop or a retry can arrive while this start is still waiting on Twitch.
      let answer: (user: { id: string; displayName: string }) => void;
      let fail: (error: Error) => void;

      beforeEach(() => {
        request.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              answer = resolve;
              fail = reject;
            })
        );
      });

      it('creates no listener once stopped, which nothing would ever stop', async () => {
        const started = integration.start();
        await integration.stop();

        answer({ id: '1', displayName: 'B' });
        await started;

        expect(twurple.listeners).toHaveLength(0);
        expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
      });

      it('leaves the retry as the only listener, so chat is not handled twice', async () => {
        const stale = integration.start();
        await integration.start();
        const retry = current();

        answer({ id: '1', displayName: 'B' });
        await stale;

        expect(twurple.listeners).toHaveLength(1);
        expect(twurple.listeners[0]).toBe(retry);
        expect(retry.stop).not.toHaveBeenCalled();
      });

      it('reports nothing when it fails after being stopped', async () => {
        const started = integration.start();
        await integration.stop();

        fail(new Error('Helix is down'));
        await started;

        expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
      });
    });

    it('stays disconnected when stopping makes the socket report a disconnect', async () => {
      await integration.start();
      acceptAll();
      const fake = current();
      fake.stop.mockImplementation(() => {
        fake.handlers.get('onUserSocketDisconnect')?.('1', undefined);
      });

      await integration.stop();

      expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
    });
  });

  describe('events', () => {
    beforeEach(async () => {
      await integration.initialize({ subscriptions: { channelCheer: true } });
      await integration.start();
    });

    const when = <E extends keyof EventMap>(event: E) => {
      const received = vi.fn<(payload: EventMap[E]) => void>();
      eventBus.on(event, received);
      return received;
    };

    it('says when the socket is ready', () => {
      const received = when('twitch.eventSub.ready');

      fire('onUserSocketReady', '1', 'session');

      expect(received).toHaveBeenCalledWith({ sessionId: 'session' });
    });

    it('publishes a stream going online with its start time', () => {
      const received = when('twitch.stream.online');
      const startDate = new Date('2026-01-01T12:00:00Z');

      fire('onStreamOnline', {
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
        startDate,
      });

      expect(received).toHaveBeenCalledWith({
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
        startedAt: startDate,
      });
    });

    it('publishes a stream going offline', () => {
      const received = when('twitch.stream.offline');

      fire('onStreamOffline', {
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
      });

      expect(received).toHaveBeenCalledWith({
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
      });
    });

    it('publishes a follow', () => {
      const received = when('twitch.follow');
      const followDate = new Date('2026-01-01T12:00:00Z');

      fire('onChannelFollow', {
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        followDate,
      });

      expect(received).toHaveBeenCalledWith({
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        followDate,
      });
    });

    it('publishes a subscription', () => {
      const received = when('twitch.subscribe');

      fire('onChannelSubscription', {
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        tier: '1000',
        isGift: true,
      });

      expect(received).toHaveBeenCalledWith({
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        tier: '1000',
        isGift: true,
      });
    });

    it('publishes a raid from the raiding channel', () => {
      const received = when('twitch.raid');

      fire('onChannelRaidTo', {
        raidingBroadcasterId: '3',
        raidingBroadcasterName: 'r',
        raidingBroadcasterDisplayName: 'R',
        viewers: 42,
      });

      expect(received).toHaveBeenCalledWith({
        fromBroadcasterId: '3',
        fromBroadcasterName: 'r',
        fromBroadcasterDisplayName: 'R',
        viewers: 42,
      });
    });

    it('publishes a cheer', () => {
      const received = when('twitch.cheer');

      fire('onChannelCheer', {
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        bits: 100,
        message: 'cheer100',
      });

      expect(received).toHaveBeenCalledWith({
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        bits: 100,
        message: 'cheer100',
      });
    });

    it('publishes a channel update as changed stream info', () => {
      const received = when('stream.info.changed');

      fire('onChannelUpdate', {});

      expect(received).toHaveBeenCalledWith({ platforms: [StreamingPlatform.TWITCH] });
    });

    it('publishes an ad break', () => {
      const received = when('twitch.ad.break');
      const startDate = new Date('2026-01-01T12:00:00Z');

      fire('onChannelAdBreakBegin', {
        durationSeconds: 90,
        startDate,
        isAutomatic: true,
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
      });

      expect(received).toHaveBeenCalledWith({
        durationSeconds: 90,
        startedAt: startDate,
        isAutomatic: true,
        broadcasterId: '1',
        broadcasterName: 'b',
        broadcasterDisplayName: 'B',
      });
    });

    it('publishes a channel point redemption', () => {
      const received = when('twitch.channelPoint.redemption');
      const redemptionDate = new Date('2026-01-01T12:00:00Z');

      fire('onChannelRedemptionAdd', {
        id: 'r1',
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        rewardId: 'reward',
        rewardTitle: 'Bonk',
        rewardCost: 500,
        input: 'hello',
        status: 'unfulfilled',
        redemptionDate,
      });

      expect(received).toHaveBeenCalledWith({
        id: 'r1',
        userId: '2',
        userName: 'v',
        userDisplayName: 'V',
        rewardId: 'reward',
        rewardTitle: 'Bonk',
        rewardCost: 500,
        input: 'hello',
        status: 'unfulfilled',
        redeemedAt: redemptionDate,
      });
    });

    describe('a chat message', () => {
      const message = (chatterId: string, badges: Record<string, string>) => ({
        broadcasterId: '1',
        broadcasterName: 'b',
        chatterId,
        chatterDisplayName: 'V',
        messageId: 'm1',
        messageText: 'hello',
        badges,
      });

      it('is published as received chat with its author and permission', () => {
        const received = when('chat.received');

        fire('onChannelChatMessage', message('2', { moderator: '1' }));

        expect(received).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: StreamingPlatform.TWITCH,
            platformUserId: '2',
            username: 'V',
            message: 'hello',
            permissionLevel: PermissionLevel.MODERATOR,
            badges: ['moderator'],
            messageId: 'm1',
            channelId: '1',
            channelName: 'b',
          })
        );
      });

      it('makes the broadcaster the broadcaster, whatever their badges', () => {
        const received = when('chat.received');

        fire('onChannelChatMessage', message('1', { subscriber: '12' }));

        expect(received).toHaveBeenCalledWith(
          expect.objectContaining({ permissionLevel: PermissionLevel.BROADCASTER })
        );
      });
    });
  });

  describe('topics', () => {
    const subscribed = () => [...current().handlers.keys()].filter((m) => !m.startsWith('onS'));

    it('subscribes to the defaults, without cheers, on the broadcaster', async () => {
      await integration.start();

      expect(current().handlers.has('onChannelCheer')).toBe(false);
      for (const method of DEFAULT_TOPIC_METHODS) {
        expect(current().handlers.has(method)).toBe(true);
      }
    });

    it('leaves out a topic the stored config turns off', async () => {
      await integration.initialize({ subscriptions: { channelFollow: false } });

      await integration.start();

      expect(subscribed()).not.toContain('onChannelFollow');
    });
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
