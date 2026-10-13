import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageEvent } from '../../../chat/chatMessage.js';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import type { ActiveBroadcast, YouTubeApiIntegration } from './YouTubeApiIntegration.js';
import type { YouTubeAuthIntegration } from './YouTubeAuthIntegration.js';
import { YouTubeChatIntegration } from './YouTubeChatIntegration.js';
import type { LiveChatMessageListResponse } from './YouTubeChatStream.js';

/** The integration's reconnect backoff ceiling; long enough to step past any scheduled retry. */
const RECONNECT_CEILING_MS = 30_000;

/** A failed request that got far enough to receive a status, as gaxios reports it. */
function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

/** A connection that failed or was severed before any status arrived. */
function transportError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * Stand-in for the response stream.
 *
 * A real EventEmitter on purpose, so it reproduces the behaviour that makes cancellation dangerous:
 * Node throws when `'error'` is emitted with no listener attached. A fake that merely recorded
 * `cancel()` would let an unhandled-error crash pass the suite.
 *
 * The post-cancel error emit deliberately over-approximates the real wrapper, which suppresses its
 * own abort fallout. The integration must not depend on that suppression — its listeners are the
 * load-bearing guard — so the fake keeps emitting.
 */
class FakeCall extends EventEmitter {
  cancelled = false;

  cancel(): void {
    this.cancelled = true;
    process.nextTick(() => {
      this.emit('error', transportError('ABORT_ERR'));
    });
  }

  emitData(response: LiveChatMessageListResponse): void {
    this.emit('data', response);
  }

  emitError(status: number): void {
    this.emit('error', httpError(status));
  }

  emitTransportError(code: string): void {
    this.emit('error', transportError(code));
  }

  emitEnd(): void {
    this.emit('end');
  }
}

const streamMock = vi.hoisted(() => ({
  stream: vi.fn(),
  close: vi.fn(),
}));

vi.mock('./YouTubeChatStream.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mirrors the exported class name.
  YouTubeChatStream: class {
    stream = streamMock.stream;
    close = streamMock.close;
  },
}));

const LIVE_BROADCAST: ActiveBroadcast = {
  id: 'broadcast-1',
  title: 'Live now',
  channelId: 'UC_broadcaster',
  liveChatId: 'chat-1',
  actualStartTime: '2026-08-31T12:00:00Z',
  scheduledStartTime: null,
};

function textMessage(text: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    snippet: { displayMessage: text, textMessageDetails: { messageText: text } },
    authorDetails: {
      channelId: 'UC_viewer',
      displayName: 'someviewer',
      isChatOwner: false,
      isChatModerator: false,
      isChatSponsor: false,
      isVerified: false,
      ...overrides,
    },
  };
}

describe('YouTubeChatIntegration', () => {
  let eventBus: EventBus;
  let integration: YouTubeChatIntegration;
  let auth: {
    getAuthClient: ReturnType<typeof vi.fn>;
    isAuthError: ReturnType<typeof vi.fn>;
    markAuthRequired: ReturnType<typeof vi.fn>;
  };
  let api: { getActiveBroadcast: ReturnType<typeof vi.fn> };
  let call: FakeCall;
  /**
   * The authorized OAuth2 client, handed straight to the stream wrapper. Identity matters — the
   * wrapper keys its cached API client on it — so this is one stable object, not a fresh literal
   * per call.
   */
  const authClient = {};

  /** Let pending promise chains settle without advancing the clock. */
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(async () => {
    vi.useFakeTimers();
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    call = new FakeCall();

    // Each open must yield a fresh call — reusing one object would stack listeners across
    // reconnects and double-deliver every message.
    streamMock.stream.mockReset().mockImplementation(() => {
      call = new FakeCall();
      return call;
    });
    streamMock.close.mockReset();

    auth = {
      getAuthClient: vi.fn(() => authClient),
      isAuthError: vi.fn(() => false),
      markAuthRequired: vi.fn(),
    };
    api = { getActiveBroadcast: vi.fn(() => Promise.resolve(LIVE_BROADCAST)) };

    integration = new YouTubeChatIntegration(
      eventBus,
      new Logger({ level: 'silent' }),
      auth as unknown as YouTubeAuthIntegration,
      api as unknown as YouTubeApiIntegration
    );

    await integration.initialize({});
    await integration.start();
  });

  afterEach(async () => {
    await integration.stop();
    vi.useRealTimers();
  });

  /** Drive the integration all the way to a live stream and consume the backlog response. */
  async function connect(): Promise<void> {
    integration.requestResolve('test');
    await flush();
    call.emitData({ items: [textMessage('backlog')], nextPageToken: 'page-1' });
  }

  it('starts idle with no timers pending', () => {
    expect(integration.getState()).toBe('idle');
    expect(api.getActiveBroadcast).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('triggers', () => {
    it('resolves and streams when the console requests go-live', async () => {
      integration.requestResolve('console');
      expect(integration.getState()).toBe('resolving');

      await flush();

      expect(integration.getState()).toBe('streaming');
      expect(streamMock.stream).toHaveBeenCalledWith('chat-1', authClient, undefined);
    });

    it('resolves when OBS reports that streaming started', async () => {
      await eventBus.emit('obs.stream.stateChanged', {
        outputActive: true,
        outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
      });
      await flush();

      expect(integration.getState()).toBe('streaming');
    });

    it('ignores an unrelated OBS output state', async () => {
      await eventBus.emit('obs.stream.stateChanged', {
        outputActive: true,
        outputState: 'OBS_WEBSOCKET_OUTPUT_PAUSED',
      });
      await flush();

      expect(integration.getState()).toBe('idle');
      expect(api.getActiveBroadcast).not.toHaveBeenCalled();
    });

    it('ignores a second go-live signal while already streaming', async () => {
      await connect();

      integration.requestResolve('console');
      await flush();

      expect(streamMock.stream).toHaveBeenCalledTimes(1);
      expect(api.getActiveBroadcast).toHaveBeenCalledTimes(1);
    });

    it('broadcasts every lifecycle transition', async () => {
      const states: string[] = [];
      eventBus.on('youtube.chat.state', (data) => {
        states.push(data.state);
      });

      await connect();
      integration.requestStop('console');
      await flush();

      expect(states).toEqual(['resolving', 'streaming', 'idle']);
    });
  });

  describe('bounded resolve', () => {
    it('retries while no broadcast is active, then opens the stream when one appears', async () => {
      api.getActiveBroadcast
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...LIVE_BROADCAST, liveChatId: null })
        .mockResolvedValue(LIVE_BROADCAST);

      integration.requestResolve('test');
      await flush();
      expect(integration.getState()).toBe('resolving');

      await vi.advanceTimersByTimeAsync(5_000);
      expect(integration.getState()).toBe('resolving');

      await vi.advanceTimersByTimeAsync(5_000);
      expect(integration.getState()).toBe('streaming');
    });

    it('gives up and returns to idle after the deadline instead of retrying forever', async () => {
      api.getActiveBroadcast.mockResolvedValue(null);

      integration.requestResolve('test');
      await vi.advanceTimersByTimeAsync(130_000);

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);

      // Bounded: roughly deadline/interval attempts, not an unbounded loop.
      expect(api.getActiveBroadcast.mock.calls.length).toBeLessThanOrEqual(26);
    });

    it('keeps retrying when the broadcast lookup throws', async () => {
      api.getActiveBroadcast
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValue(LIVE_BROADCAST);

      integration.requestResolve('test');
      await flush();
      expect(integration.getState()).toBe('resolving');

      await vi.advanceTimersByTimeAsync(5_000);
      expect(integration.getState()).toBe('streaming');
    });
  });

  describe('messages', () => {
    it('skips the backlog response of a fresh resolve', async () => {
      const messages: unknown[] = [];
      eventBus.on('chat.received', (data) => {
        messages.push(data);
      });

      integration.requestResolve('test');
      await flush();
      call.emitData({ items: [textMessage('old news')], nextPageToken: 'page-1' });
      await flush();

      expect(messages).toEqual([]);
    });

    it('emits chat.received with the payload shape ChatRouter already expects', async () => {
      const messages: ChatMessageEvent[] = [];
      eventBus.on('chat.received', (data) => {
        messages.push(data);
      });

      await connect();
      call.emitData({ items: [textMessage('hello there')] });
      await flush();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        platform: StreamingPlatform.YOUTUBE,
        platformUserId: 'UC_viewer',
        username: 'someviewer',
        message: 'hello there',
        permissionLevel: PermissionLevel.VIEWER,
        badges: [],
        timestamp: expect.any(Number),
        messageId: 'msg-1',
        channelId: 'UC_broadcaster',
      });
    });

    it('emits commands as ordinary chat.received events, leaving parsing to ChatRouter', async () => {
      const messages: ChatMessageEvent[] = [];
      eventBus.on('chat.received', (data) => {
        messages.push(data);
      });

      await connect();
      call.emitData({ items: [textMessage('!bonk someone', { isChatModerator: true })] });
      await flush();

      expect(messages[0]).toMatchObject({
        message: '!bonk someone',
        permissionLevel: PermissionLevel.MODERATOR,
        badges: ['moderator'],
      });
    });
  });

  describe('stream errors', () => {
    it('reconnects from the stored page token when the connection drops', async () => {
      await connect();

      call.emitError(503);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(streamMock.stream).toHaveBeenLastCalledWith('chat-1', authClient, 'page-1');
      expect(integration.getState()).toBe('streaming');
    });

    it('delivers messages from the first response after a reconnect', async () => {
      const messages: unknown[] = [];
      eventBus.on('chat.received', (data) => {
        messages.push(data);
      });

      await connect();
      call.emitError(503);
      await vi.advanceTimersByTimeAsync(1_000);

      // The reconnect resumes from nextPageToken, so its first response is real traffic, not
      // backlog — dropping it would silently lose messages.
      call.emitData({ items: [textMessage('after reconnect')] });
      await flush();

      expect(messages).toHaveLength(1);
    });

    it('backs off exponentially across repeated drops', async () => {
      await connect();

      call.emitError(503);
      await vi.advanceTimersByTimeAsync(999);
      expect(streamMock.stream).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(streamMock.stream).toHaveBeenCalledTimes(2);

      call.emitError(503);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(streamMock.stream).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(streamMock.stream).toHaveBeenCalledTimes(3);
    });

    it('reconnects when the server ends the stream cleanly', async () => {
      await connect();

      call.emitEnd();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(streamMock.stream).toHaveBeenCalledTimes(2);
    });

    it('returns to idle when the chat has ended', async () => {
      await connect();

      call.emitError(400);
      await flush();

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns to idle when the chat is not found', async () => {
      await connect();

      call.emitError(404);
      await flush();

      expect(integration.getState()).toBe('idle');
    });

    it('returns to idle when the chat cannot be read', async () => {
      await connect();

      call.emitError(403);
      await flush();

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('reconnects when the connection is severed without a status', async () => {
      await connect();

      // The likeliest failure by far: the status arrives once at the start, so everything that goes
      // wrong for the rest of a multi-hour stream is a socket error with no status at all.
      call.emitTransportError('ECONNRESET');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(streamMock.stream).toHaveBeenLastCalledWith('chat-1', authClient, 'page-1');
      expect(integration.getState()).toBe('streaming');
    });

    it('backs off rather than hammering when rate limited', async () => {
      await connect();

      call.emitError(429);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(integration.getState()).toBe('streaming');
      expect(streamMock.stream).toHaveBeenCalledTimes(2);
    });

    it('returns to idle on a status-less error that is not a dropped connection', async () => {
      await connect();

      // A bug in our own parsing, say. Reconnecting would loop on it; idling surfaces it instead.
      call.emitTransportError('ERR_SOMETHING_UNEXPECTED');
      await flush();

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('flags re-authorization when the broadcast lookup fails on a dead token', async () => {
      auth.isAuthError.mockReturnValue(true);
      api.getActiveBroadcast.mockRejectedValue(new Error('invalid_grant'));

      integration.requestResolve('test');
      await flush();

      expect(auth.markAuthRequired).toHaveBeenCalled();
      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('refreshes and reconnects when an aged-out access token is rejected', async () => {
      await connect();

      // Ordinary hourly expiry: a request's authorization is fixed when it opens, so a long stream
      // will be rejected eventually. That is not a re-authorization.
      call.emitError(401);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(auth.markAuthRequired).not.toHaveBeenCalled();
      expect(streamMock.stream).toHaveBeenCalledTimes(2);
      expect(integration.getState()).toBe('streaming');
    });

    it('flags re-authorization when a refreshed token is rejected too', async () => {
      await connect();

      call.emitError(401);
      await vi.advanceTimersByTimeAsync(1_000);
      call.emitError(401);
      await flush();

      expect(auth.markAuthRequired).toHaveBeenCalled();
      expect(integration.getState()).toBe('idle');
    });

    it('treats a token rejection after a good response as fresh expiry again', async () => {
      await connect();

      call.emitError(401);
      await vi.advanceTimersByTimeAsync(1_000);
      call.emitData({ items: [textMessage('still here')] });
      await flush();

      // The successful response clears the retry flag, so the next expiry is not mistaken for a
      // dead grant an hour later.
      call.emitError(401);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(auth.markAuthRequired).not.toHaveBeenCalled();
      expect(integration.getState()).toBe('streaming');
    });

    it('gives up instead of reconnecting forever when the stream keeps ending', async () => {
      await connect();

      // A broadcast that has ended closes the stream immediately, every time.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        call.emitEnd();
        await vi.advanceTimersByTimeAsync(RECONNECT_CEILING_MS);
      }

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns to idle when a response reports the broadcast went offline', async () => {
      await connect();

      call.emitData({ items: [], offlineAt: '2026-08-31T13:00:00Z' });
      await flush();

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns to idle when auth has gone away before the stream opens', async () => {
      auth.getAuthClient.mockReturnValue(null);

      integration.requestResolve('test');
      await flush();

      // No client means the grant is gone, not that the network hiccuped; reconnecting would just
      // fail the same way. Idle with no timers pending, waiting for the next go-live signal.
      expect(streamMock.stream).not.toHaveBeenCalled();
      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('stop during in-flight work', () => {
    it('does not open a stream when stopped mid-lookup', async () => {
      let resolveLookup: (value: unknown) => void = () => {};
      api.getActiveBroadcast.mockReturnValue(
        new Promise((resolve) => {
          resolveLookup = resolve;
        })
      );

      integration.requestResolve('console');
      integration.requestStop('console');

      // The lookup that was already in flight now comes back with a live broadcast.
      resolveLookup(LIVE_BROADCAST);
      await flush();

      expect(streamMock.stream).not.toHaveBeenCalled();
      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not arm a second retry loop when stopped mid-lookup', async () => {
      let resolveLookup: (value: unknown) => void = () => {};
      api.getActiveBroadcast.mockReturnValue(
        new Promise((resolve) => {
          resolveLookup = resolve;
        })
      );

      integration.requestResolve('console');
      integration.requestStop('console');

      resolveLookup(null);
      await flush();

      // A stale continuation arming its own retry timer would leave two resolve loops running once
      // the next go-live signal starts a fresh one.
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('teardown', () => {
    it('cancels the call and clears timers when OBS stops streaming', async () => {
      await connect();

      await eventBus.emit('obs.stream.stateChanged', {
        outputActive: false,
        outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
      });
      await flush();

      expect(call.cancelled).toBe(true);
      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('survives an abort error delivered after cancel()', async () => {
      await connect();

      integration.requestStop('console');

      // Aborting a request can surface an error a tick later. If the integration had detached its
      // error listener during teardown, this emit would be unhandled and Node would throw — taking
      // the backend down on every disconnect.
      await expect(flush()).resolves.not.toThrow();

      expect(call.listenerCount('error')).toBeGreaterThan(0);
      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores late events from a call it has already abandoned', async () => {
      const messages: unknown[] = [];
      eventBus.on('chat.received', (data) => {
        messages.push(data);
      });

      await connect();
      const abandoned = call;
      integration.requestStop('console');
      await flush();

      streamMock.stream.mockClear();
      abandoned.emitData({ items: [textMessage('too late')] });
      abandoned.emitEnd();
      await flush();

      expect(messages).toEqual([]);
      expect(streamMock.stream).not.toHaveBeenCalled();
      expect(integration.getState()).toBe('idle');
    });

    it('cancels an in-flight resolve when the console asks to stop', async () => {
      api.getActiveBroadcast.mockResolvedValue(null);

      integration.requestResolve('console');
      await flush();
      expect(vi.getTimerCount()).toBe(1);

      integration.requestStop('console');

      expect(integration.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('closes the channel and stops responding to signals on stop()', async () => {
      await connect();
      await integration.stop();

      expect(call.cancelled).toBe(true);
      expect(streamMock.close).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      streamMock.stream.mockClear();
      await eventBus.emit('obs.stream.stateChanged', {
        outputActive: true,
        outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
      });
      await flush();

      expect(streamMock.stream).not.toHaveBeenCalled();
    });
  });
});
