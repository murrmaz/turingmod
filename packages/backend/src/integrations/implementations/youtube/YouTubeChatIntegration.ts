import type { YouTubeChatState } from '@turingmod/shared';
import {
  IntegrationGroup,
  IntegrationName,
  IntegrationStatus,
  PermissionLevel,
  StreamingPlatform,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import type { IIntegration } from '../../interfaces/IIntegration.js';
import { ReconnectBackoff } from '../../ReconnectBackoff.js';
import { type BroadcastIdentity, YouTubeApiIntegration } from './YouTubeApiIntegration.js';
import { YouTubeAuthIntegration } from './YouTubeAuthIntegration.js';
import {
  type LiveChatFrame,
  type LiveChatMessage,
  type LiveChatStreamCall,
  YouTubeChatStream,
} from './YouTubeChatStream.js';

/** How often to re-check for an active broadcast after a request to connect. */
const RESOLVE_RETRY_INTERVAL_MS = 5_000;
/**
 * How long to keep looking before giving up. OBS asks for chat when the stream starts going out,
 * but the broadcast only exposes a liveChatId once YouTube transitions it to `live`, which lags by
 * seconds.
 * Bounded so a false signal (e.g. a Twitch-only stream) can't leave a timer running forever.
 */
const RESOLVE_TIMEOUT_MS = 120_000;

/**
 * Give up reconnecting after this many consecutive failures and return to idle. Without a cap, a
 * broadcast that ends by closing the stream cleanly would reconnect forever while still reporting
 * `streaming`. Any successful response resets the count.
 */
const MAX_RECONNECT_ATTEMPTS = 8;

/** The broadcast whose chat is being streamed. */
export type StreamedBroadcast = BroadcastIdentity & { liveChatId: string };

/** What asked chat to connect or disconnect, for the log. */
export type ChatTrigger = 'OBS' | 'console';

/**
 * HTTP statuses that mean "the chat is gone", as opposed to "the connection dropped". 400 is what
 * the streaming endpoint returns for a chat that has ended (the transcoded form of the RPC's
 * FAILED_PRECONDITION), 404 for a liveChatId that no longer resolves, and 403 for a chat the
 * grant can see but not read.
 */
const TERMINAL_STATUSES: ReadonlySet<number> = new Set([400, 403, 404]);

/**
 * Statuses worth retrying. Everything 5xx is a server-side blip, and 429 is rate limiting that the
 * existing exponential backoff already answers correctly.
 *
 * A dropped connection is the other reconnectable case, and it arrives with no HTTP status at all
 * — see {@link isTransportError}.
 */
const isReconnectableStatus = (status: number): boolean => status >= 500 || status === 429;

/**
 * Node/undici error codes for a connection that failed or was severed mid-stream. A long-lived
 * response is far more likely to end this way than with a status, since the status arrives once at
 * the start and everything after that is just a socket.
 */
const TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * The HTTP status of a failed request, or undefined when the failure never got that far. Gaxios
 * puts it on the error's `response`, and also mirrors it onto `status` on newer errors.
 */
function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { status, response } = error as {
    status?: unknown;
    response?: { status?: unknown } | undefined;
  };

  if (typeof response?.status === 'number') {
    return response.status;
  }
  return typeof status === 'number' ? status : undefined;
}

/** Whether a status-less failure is a dropped connection rather than a genuine surprise. */
function isTransportError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code)) {
    return true;
  }
  // Node reports a server closing a keep-alive connection with this message and no useful code.
  return typeof message === 'string' && message.includes('socket hang up');
}

/**
 * YouTube Chat Integration
 *
 * Streams the active broadcast's live chat over the `youtube.v3.liveChat.messages.stream`
 * server-streaming RPC and normalizes each message into the same `chat.received` EventBus event
 * Twitch emits, so ChatRouter stays platform-agnostic.
 *
 * There are no periodic timers. The integration idles until it is asked to connect — by
 * YouTubeChatAutoConnect when OBS is streaming, or from the console — then resolves the
 * broadcast's liveChatId with a short bounded retry and opens the stream. The liveChatId only
 * exists while a broadcast is active, so it is re-resolved for every new stream. Deciding when
 * the broadcaster is live isn't this class's concern.
 *
 * Depends on: YouTubeAuthIntegration, YouTubeApiIntegration
 */
@singleton()
export class YouTubeChatIntegration extends BaseIntegration {
  readonly name = IntegrationName.YOUTUBE_CHAT;

  private broadcast: StreamedBroadcast | null = null;
  private nextPageToken: string | undefined;

  private state: YouTubeChatState = 'idle';
  private running = false;

  private readonly chatStream = new YouTubeChatStream();
  private call: LiveChatStreamCall | null = null;

  private resolveTimer: NodeJS.Timeout | null = null;
  private resolveDeadline = 0;
  /** When to reopen a dropped stream. A working response, or a new broadcast, starts it over. */
  private readonly backoff = new ReconnectBackoff();

  /**
   * Bumped by every teardown. Async work captures it and bails if it changed while awaiting, so a
   * stop that lands mid-flight can't be undone by a stale continuation reconnecting or arming a
   * second retry loop.
   */
  private epoch = 0;

  /**
   * Whether the current stream has already retried once after a 401. An access token expires
   * roughly hourly and a request's authorization is fixed when it opens, so the first rejection is
   * ordinary expiry: reconnecting makes the OAuth client mint a fresh token. A second rejection
   * before any successful response means the grant itself is dead.
   */
  private authRetried = false;

  /**
   * Skip the first response of a fresh resolve so chat backlog isn't replayed as new activity.
   * Deliberately NOT reset on reconnect: a reconnect resumes from nextPageToken and its first
   * response carries real messages we'd otherwise drop.
   */
  private primed = false;

  constructor(
    private eventBus: EventBus,
    logger: Logger,
    private authIntegration: YouTubeAuthIntegration,
    private apiIntegration: YouTubeApiIntegration
  ) {
    super(logger, { component: 'YouTubeChat' });
  }

  override getDependencies(): IIntegration[] {
    return [this.authIntegration, this.apiIntegration];
  }

  override getGroup(): IntegrationGroup {
    return IntegrationGroup.YOUTUBE;
  }

  start(): Promise<void> {
    this.logger.debug('Starting YouTube Chat integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    if (!this.authIntegration.getAuthClient()) {
      throw new Error('YouTubeAuthIntegration must be started (and authorized) first');
    }

    this.running = true;
    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.debug('YouTube Chat integration started; idle until asked to connect');

    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping YouTube Chat integration');

    this.running = false;
    this.teardown();
    this.chatStream.close();
    this.setStatus(IntegrationStatus.DISCONNECTED);

    this.logger.debug('YouTube Chat integration stopped');
    return Promise.resolve();
  }

  /** Whether it has been started, so chat can be connected on request. */
  isRunning(): boolean {
    return this.running;
  }

  /** Current lifecycle state, for the console's go-live control. */
  getState(): YouTubeChatState {
    return this.state;
  }

  /**
   * The broadcast whose chat is being streamed, or null when not streaming. While it's set the
   * broadcast is live, so its fixed fields (its id, chat and start times) need no lookup of their
   * own.
   */
  getBroadcast(): StreamedBroadcast | null {
    return this.state === 'streaming' ? this.broadcast : null;
  }

  /**
   * Look for an active broadcast and connect its chat. A no-op when already resolving or
   * streaming, so overlapping requests can't stack up retry loops.
   */
  connectChat(trigger: ChatTrigger): void {
    if (!this.running) {
      this.logger.warn(`Not connecting chat for ${trigger}: integration is not running`);
      return;
    }
    if (this.state !== 'idle') {
      this.logger.debug(`Not connecting chat for ${trigger}: already ${this.state}`);
      return;
    }

    this.logger.info(`Looking for an active broadcast, asked by ${trigger}`);
    this.setState('resolving');
    this.resolveDeadline = Date.now() + RESOLVE_TIMEOUT_MS;
    void this.attemptResolve();
  }

  /** Disconnect from chat and return to idle. */
  disconnectChat(trigger: ChatTrigger): void {
    if (this.state === 'idle') {
      return;
    }

    this.logger.info(`Disconnecting YouTube chat, asked by ${trigger}`);
    this.teardown();
  }

  /**
   * One attempt at resolving the active broadcast's liveChatId. Retries on a short interval until
   * the bounded deadline passes, because the broadcast usually isn't `live` yet when the signal
   * arrives.
   */
  private async attemptResolve(): Promise<void> {
    if (!this.running || this.state !== 'resolving') {
      return;
    }

    const epoch = this.epoch;

    try {
      const broadcast = await this.apiIntegration.getActiveBroadcast();

      // A stop that landed while the lookup was in flight wins; don't resurrect the old attempt.
      if (this.isStale(epoch)) {
        return;
      }

      if (broadcast?.liveChatId) {
        const { title: _title, ...identity } = broadcast;
        this.broadcast = { ...identity, liveChatId: broadcast.liveChatId };
        this.nextPageToken = undefined;
        this.primed = false;
        this.backoff.reset();
        this.logger.info('Resolved active YouTube live chat', {
          liveChatId: broadcast.liveChatId,
        });
        this.openStream();
        return;
      }
    } catch (error) {
      if (this.isStale(epoch)) {
        return;
      }
      if (this.handleAuthError(error)) {
        return;
      }
      this.logger.warn('Failed to check for an active YouTube broadcast', error);
    }

    if (Date.now() >= this.resolveDeadline) {
      this.logger.info('No active YouTube broadcast appeared; returning to idle');
      this.teardown();
      return;
    }

    this.resolveTimer = setTimeout(() => {
      void this.attemptResolve();
    }, RESOLVE_RETRY_INTERVAL_MS);
  }

  /** Open (or reopen) the message stream for the resolved chat. */
  private openStream(): void {
    const liveChatId = this.broadcast?.liveChatId;
    if (!(this.running && liveChatId)) {
      return;
    }

    // The client attaches and refreshes the access token itself, so opening a stream needs nothing
    // but the authorized client. Its absence means auth was torn down under us.
    const authClient = this.authIntegration.getAuthClient();
    if (!authClient) {
      this.logger.warn('No YouTube auth client available; cannot open chat stream');
      this.teardown();
      return;
    }

    this.setState('streaming');
    const call = this.chatStream.stream(liveChatId, authClient, this.nextPageToken);
    this.call = call;

    // Listeners stay attached for the life of the call and check whether it is still the current
    // one, because the request opens asynchronously and can still deliver events after we've moved
    // on. Detaching them instead would risk an unhandled 'error', which Node turns into a throw.
    call.on('data', (response) => {
      if (this.call === call) {
        this.handleResponse(response);
      }
    });
    call.on('error', (error) => {
      if (this.call === call) {
        this.handleStreamError(error);
      }
    });
    call.on('end', () => {
      if (this.call === call) {
        this.handleStreamEnd();
      }
    });

    this.logger.info('YouTube live chat stream open');
  }

  private handleResponse(response: LiveChatFrame): void {
    // A working response clears both failure counters: later trouble starts from scratch.
    this.backoff.reset();
    this.authRetried = false;

    // The first response of a fresh resolve is chat backlog — take the cursor, drop the messages.
    if (this.primed) {
      for (const item of response.items ?? []) {
        this.handleMessage(item);
      }
    } else {
      this.primed = true;
    }

    if (response.nextPageToken) {
      this.nextPageToken = response.nextPageToken;
    }

    // YouTube sets offlineAt when the underlying broadcast has gone offline. Reconnecting would
    // just re-fetch a dead chat, so go idle and wait for the next request to connect.
    if (response.offlineAt) {
      this.logger.info('YouTube broadcast went offline; returning to idle', {
        offlineAt: response.offlineAt,
      });
      this.teardown();
    }
  }

  private handleStreamError(error: unknown): void {
    this.detachCall();

    if (!this.running) {
      return;
    }

    const status = getHttpStatus(error);

    if (status === 401) {
      // Access tokens last about an hour and a request's authorization is fixed when it opens, so
      // a long-running stream will eventually be rejected purely because its token aged out. That
      // is not a re-authorization: reconnecting mints a fresh token. Only a second rejection, with
      // no successful response in between, means the grant itself is dead.
      if (this.authRetried) {
        this.logger.warn('YouTube chat stream rejected a refreshed token; re-authorization needed');
        this.authIntegration.markAuthRequired();
        this.teardown();
        return;
      }

      this.authRetried = true;
      this.logger.info('YouTube access token was rejected; refreshing and reconnecting');
      this.scheduleReconnect();
      return;
    }

    if (this.authIntegration.isAuthError(error)) {
      this.logger.warn('YouTube chat stream failed on a dead token; re-authorization needed');
      this.authIntegration.markAuthRequired();
      this.teardown();
      return;
    }

    if (status !== undefined && TERMINAL_STATUSES.has(status)) {
      // The chat ended, was disabled, or the broadcast is gone. Wait for the next request to connect.
      this.logger.info('YouTube live chat is no longer available; returning to idle', { status });
      this.teardown();
      return;
    }

    if (status === undefined ? isTransportError(error) : isReconnectableStatus(status)) {
      this.logger.warn('YouTube chat stream dropped; reconnecting', { status });
      this.scheduleReconnect();
      return;
    }

    // Anything else is unexpected. Surface it loudly rather than silently idling — with polling
    // removed there is no degraded mode, so a quiet failure looks identical to a quiet stream.
    this.logger.error('YouTube chat stream failed unexpectedly; returning to idle', error);
    this.teardown();
  }

  /** A clean server-side end still means the stream is over; reconnect and resume. */
  private handleStreamEnd(): void {
    this.detachCall();

    if (!this.running || this.state !== 'streaming') {
      return;
    }

    this.logger.info('YouTube chat stream ended; reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.running) {
      return;
    }

    if (this.backoff.attempts >= MAX_RECONNECT_ATTEMPTS) {
      // Bounded on purpose: a broadcast that has ended tends to close the stream immediately every
      // time, which would otherwise be an endless reconnect loop still reporting `streaming`.
      this.logger.warn(
        `YouTube chat stream failed ${this.backoff.attempts} times in a row; returning to idle`
      );
      this.teardown();
      return;
    }

    this.backoff.schedule(() => this.openStream());
  }

  /**
   * Flag a dead refresh token if that's what an error is. The streaming path bypasses
   * YouTubeApiIntegration.request(), so this integration reports re-auth itself.
   * Returns true when the error was handled as an auth failure.
   */
  private handleAuthError(error: unknown): boolean {
    if (!this.authIntegration.isAuthError(error)) {
      return false;
    }

    this.logger.warn('YouTube chat failed due to an auth error; re-authorization needed');
    this.authIntegration.markAuthRequired();
    this.teardown();
    return true;
  }

  /**
   * Stop treating the current call as current, WITHOUT removing its listeners.
   *
   * A stream's events can arrive a tick or more after we've stopped caring — the request opens
   * asynchronously, and a body can emit right up until it is destroyed. Removing the error listener
   * here would risk leaving one of those emits unhandled, and Node throws on an unhandled `'error'`
   * — crashing the backend. Leaving the listeners attached lets them absorb it; they check call
   * identity, so they no-op for a call we've moved past.
   */
  private detachCall(): void {
    this.call = null;
  }

  /** True if a teardown happened since `epoch` was captured, i.e. this async work is obsolete. */
  private isStale(epoch: number): boolean {
    return !this.running || this.epoch !== epoch;
  }

  /** Return to idle: no timers, no call, no resolved broadcast. */
  private teardown(): void {
    if (this.resolveTimer) {
      clearTimeout(this.resolveTimer);
      this.resolveTimer = null;
    }
    this.backoff.reset();

    // Detach before cancelling so any abort fallout is recognized as belonging to a call we've
    // already abandoned, rather than kicking off a reconnect.
    const cancelled = this.call;
    this.detachCall();
    cancelled?.cancel();

    // Invalidate any async work still in flight (a broadcast lookup, a token fetch).
    this.epoch += 1;

    this.broadcast = null;
    this.nextPageToken = undefined;
    this.primed = false;
    this.authRetried = false;
    this.setState('idle');
  }

  /**
   * Record a lifecycle transition and tell the console about it, so the go-live control reflects
   * whether chat is actually connected rather than just whether the integration is enabled.
   */
  private setState(state: YouTubeChatState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.eventBus.emit('youtube.chat.state', { state });
  }

  /**
   * Normalize one live chat message into `chat.received`.
   * Payloads mirror TwitchEventSubIntegration.handleChatMessage() exactly.
   */
  private handleMessage(item: LiveChatMessage): void {
    const author = item.authorDetails;
    const snippet = item.snippet;
    const messageText = snippet?.displayMessage ?? snippet?.textMessageDetails?.messageText ?? '';

    if (!(author && messageText)) {
      return;
    }

    const platformUserId = author.channelId ?? '';
    const username = author.displayName ?? '';
    const permissionLevel = this.getPermissionFromAuthor(author);
    const badges = this.getBadgesFromAuthor(author);

    this.logger.debug('YouTube chat message received', { user: username, message: messageText });

    // OwnChatMessages republishes this as `chat.message`, minus TuringMod's own messages.
    // Commands are parsed out by ChatRouter, after moderation.
    this.eventBus.emit('chat.received', {
      platform: StreamingPlatform.YOUTUBE,
      platformUserId,
      username,
      message: messageText,
      permissionLevel,
      badges,
      timestamp: Date.now(),
      messageId: item.id ?? '',
      channelId: this.broadcast?.channelId ?? '',
    });
  }

  /**
   * Map YouTube author roles to a PermissionLevel. Role mapping is lossy: YouTube has no VIP
   * equivalent, and a channel "member" (sponsor) is treated as a subscriber.
   */
  private getPermissionFromAuthor(
    author: NonNullable<LiveChatMessage['authorDetails']>
  ): PermissionLevel {
    if (author.isChatOwner) return PermissionLevel.BROADCASTER;
    if (author.isChatModerator) return PermissionLevel.MODERATOR;
    if (author.isChatSponsor) return PermissionLevel.SUBSCRIBER;
    return PermissionLevel.VIEWER;
  }

  /** Derive Twitch-badge-style role markers from YouTube author flags (parity only). */
  private getBadgesFromAuthor(author: NonNullable<LiveChatMessage['authorDetails']>): string[] {
    const badges: string[] = [];
    if (author.isChatOwner) badges.push('owner');
    if (author.isChatModerator) badges.push('moderator');
    if (author.isChatSponsor) badges.push('sponsor');
    if (author.isVerified) badges.push('verified');
    return badges;
  }
}
