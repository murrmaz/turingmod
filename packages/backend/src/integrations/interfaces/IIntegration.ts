import type { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import type { IOAuthIntegration } from './IOAuthIntegration.js';

/**
 * Every event an integration emits, with its arguments. IntegrationManager is
 * the listener: it forwards each one to the EventBus.
 */
export interface IntegrationEvents {
  /** The integration's status changed; its reason is in getErrorMessage(). */
  status: [status: IntegrationStatus];
  /** OAuth credentials were rotated. Not a status change: see reportTokenRefreshed(). */
  tokenRefreshed: [refresh: { expiresAt?: number }];
  /**
   * Something failed without changing the integration's status (a sound that
   * wouldn't play). Not named 'error', which Node's EventEmitter throws on when
   * nothing is listening.
   */
  failure: [error: Error];
}

/**
 * What should happen to an integration when one of its dependencies becomes
 * unusable (ERROR, NEEDS_REAUTH, BLOCKED, DISCONNECTED).
 */
export enum DependencyFailurePolicy {
  /**
   * Tear the integration down and restart it when the dependency recovers.
   *
   * The default, and the right answer for anything holding a long-lived
   * connection: a dependency failing is evidence about the environment, not
   * just about a token, so a socket established under the old conditions
   * can't be assumed to still be valid. TwitchEventSubIntegration's WebSocket
   * and YouTubeChatIntegration's chat stream both reconnect and resubscribe
   * from scratch for that reason.
   */
  STOP = 'stop',

  /**
   * Leave the integration running and report BLOCKED until the dependency is
   * back.
   *
   * For integrations that hold nothing bound to the dependency's credentials
   * and resolve them on access instead — the API layers. Stopping those is
   * redundant: there is nothing to tear down, and BLOCKED says more plainly
   * than DISCONNECTED that they are waiting on something else.
   *
   * An integration taking this policy must refuse to act while its
   * dependency isn't connected — see TwitchApiIntegration.request().
   * Resolving a client on access protects against holding the *wrong* object;
   * it does nothing about holding the right object with dead credentials.
   */
  BLOCK = 'block',
}

/**
 * Integration interface
 * All platform integrations must implement this interface
 */
export interface IIntegration {
  /** Unique integration name */
  readonly name: string;

  /**
   * This integration's OAuth capability view, or null if it doesn't support
   * OAuth. Callers narrow with a plain `if (integration.oauth)` check instead
   * of a runtime type guard.
   */
  readonly oauth: IOAuthIntegration | null;

  /**
   * Apply the integration's stored config, as read from the database or sent by the console. The
   * integration parses it against its own schema, so this is where the stored value stops being
   * unknown; it throws, naming the fields that were wrong, when the config doesn't fit.
   */
  initialize(stored: unknown): Promise<void>;

  /**
   * Start the integration
   */
  start(): Promise<void>;

  /**
   * Stop the integration
   */
  stop(): Promise<void>;

  /**
   * Get current status
   */
  getStatus(): IntegrationStatus;

  /**
   * Subscribe to one of this integration's events (see IntegrationEvents).
   */
  on<K extends keyof IntegrationEvents>(
    event: K,
    handler: (...args: IntegrationEvents[K]) => void
  ): void;

  /**
   * How this integration should be treated when a dependency becomes
   * unusable. BaseIntegration defaults it to STOP; integrations that can
   * safely keep running override it.
   */
  readonly dependencyFailurePolicy: DependencyFailurePolicy;

  /**
   * The integrations that must be CONNECTED before this one can start, as references rather than
   * names; empty when there are none. Implementations return the very instances they already take
   * in their constructor, so the declared graph cannot drift out of sync with the injected one
   * and a misspelled dependency is a compile error instead of a runtime lookup failure.
   */
  getDependencies(): IIntegration[];

  /**
   * The group this integration belongs to (e.g. the three Twitch integrations), which the console
   * shows together; null when it stands alone.
   */
  getGroup(): IntegrationGroup | null;

  /** True for an integration that isn't implemented yet, which the console shows as planned. */
  readonly placeholder: boolean;

  /**
   * Why the integration is in its current status, for ERROR, NEEDS_REAUTH and BLOCKED; undefined
   * for any other status.
   */
  getErrorMessage(): string | undefined;

  /**
   * Report a failure that happened outside the integration's own start()/stop()
   * lifecycle (e.g. a caller like IntegrationManager declining to start it
   * because a dependency isn't ready). Transitions status to ERROR with the
   * given message so it's visible on the wire, same as an internal failure.
   */
  reportError(message: string): void;

  /**
   * Report that this integration can't run because a declared dependency
   * isn't connected. Separate from reportError() so a prerequisite being off
   * doesn't surface — or persist — as a failure of this integration.
   */
  reportBlocked(reason: string): void;
}
