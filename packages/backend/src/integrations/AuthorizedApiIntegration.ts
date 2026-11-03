import { type IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import type { Logger } from '../utils/Logger.js';
import { BaseIntegration } from './BaseIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from './interfaces/IIntegration.js';

/**
 * An API layer over an auth integration (Twitch Helix, the YouTube Data API, the Spotify Web
 * API): the client calls go through, and the integration status that says whether it can be used.
 *
 * Owns connection health only — which client to use, and refusing to call while auth isn't
 * usable. What a call is for belongs to whoever makes it (a platform façade, a command), through
 * request().
 *
 * Holds nothing bound to the auth grant, since the client is resolved on every access, so a
 * dependency failure blocks it rather than stopping it (`DependencyFailurePolicy.BLOCK`): there is
 * nothing to tear down. The other half of that policy is enforced here, so a subclass can't have
 * one without the other: no client is handed out, and no call made, while the auth integration
 * isn't CONNECTED. Auth can be NEEDS_REAUTH and still hold its provider (`markAuthRequired()`
 * doesn't discard it), so a client existing says nothing about whether it can still refresh.
 *
 * Stopping it is real: nothing is handed out while it's DISCONNECTED, even with auth connected, and
 * getStoppedReason() lets a façade say so. Starting one that auth is ready for is cheap, so an
 * integration that has never been started counts as stopped too.
 *
 * A subclass supplies resolveClient(), and overrides onRequestFailure() to recognize the
 * provider's way of saying the grant is gone.
 */
export abstract class AuthorizedApiIntegration<
  TAuth extends IIntegration,
  TClient,
> extends BaseIntegration {
  /**
   * @param service The provider's name as the streamer knows it ("Twitch"), for messages.
   */
  protected constructor(
    logger: Logger,
    protected readonly service: string,
    protected readonly auth: TAuth
  ) {
    super(logger, { component: `${service}API` });
  }

  override getDependencies(): IIntegration[] {
    return [this.auth];
  }

  override get dependencyFailurePolicy(): DependencyFailurePolicy {
    return DependencyFailurePolicy.BLOCK;
  }

  override getGroup(): IntegrationGroup | null {
    return this.auth.getGroup();
  }

  /**
   * Report whether a client can be had. Cheap and idempotent, which IntegrationManager relies on:
   * it starts a BLOCKED integration again once its dependency recovers.
   */
  start(): Promise<void> {
    this.setStatus(IntegrationStatus.CONNECTING);

    if (!this.currentClient()) {
      const error = new Error(`${this.auth.name} must be connected before ${this.name} can start`);
      this.logger.error(`Failed to start ${this.service} API integration`, error);
      this.setStatus(IntegrationStatus.ERROR, error.message);
      return Promise.reject(error);
    }

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.debug(`${this.service} API integration started`);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.forgetClient();
    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.debug(`${this.service} API integration stopped`);
    return Promise.resolve();
  }

  /**
   * Run a call through the current client. Throws while this is stopped or auth isn't connected. A
   * failure goes to
   * onRequestFailure(), which may retry it once.
   */
  async request<T>(call: (client: TClient) => Promise<T>): Promise<T> {
    const client = this.requireClient();
    try {
      return await call(client);
    } catch (error) {
      return await this.onRequestFailure(error, () => call(this.requireClient()));
    }
  }

  /** Why calls are refused because this was stopped or never started, or null if it wasn't. */
  getStoppedReason(): string | null {
    return this.status === IntegrationStatus.DISCONNECTED
      ? `${this.service} API is stopped: start it on the Integrations page`
      : null;
  }

  /**
   * The client to call through, or null while this is stopped, auth isn't CONNECTED, or auth has
   * nothing to build on.
   */
  protected currentClient(): TClient | null {
    if (
      this.status === IntegrationStatus.DISCONNECTED ||
      this.auth.getStatus() !== IntegrationStatus.CONNECTED
    ) {
      this.forgetClient();
      return null;
    }
    return this.resolveClient();
  }

  /**
   * The client built on the auth integration's current credentials, or null if it has none.
   * Called only while auth is CONNECTED, on every access, so a client built on credentials the
   * auth integration has since replaced must be rebuilt (see ClientCache).
   */
  protected abstract resolveClient(): TClient | null;

  /** Drop a cached client, on stop() and while auth isn't connected. */
  protected forgetClient(): void {
    // A subclass whose client never goes stale caches nothing.
  }

  /**
   * React to a failed call: report a dead grant, or retry once with `retry`. Rethrows by default;
   * an override must rethrow, or return what the retry returns.
   */
  protected onRequestFailure<T>(error: unknown, _retry: () => Promise<T>): Promise<T> {
    return Promise.reject(error);
  }

  private requireClient(): TClient {
    const stopped = this.getStoppedReason();
    if (stopped) {
      throw new Error(stopped);
    }
    const client = this.currentClient();
    if (!client) {
      throw new Error(`${this.service} is not connected`);
    }
    return client;
  }
}
