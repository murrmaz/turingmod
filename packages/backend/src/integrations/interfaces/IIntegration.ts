import type { IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import type { IOAuthIntegration } from './IOAuthIntegration.js';

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
   * destructive rather than merely redundant: stop() also discards unrelated
   * state (TwitchApiIntegration's shoutout cooldowns), so a brief auth blip
   * would silently forget Twitch's global shoutout cooldown.
   *
   * An integration taking this policy must refuse to act while its
   * dependency isn't connected — see TwitchApiIntegration.resolveApiClient().
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

  /** Integration version */
  readonly version: string;

  /**
   * This integration's OAuth capability view, or null if it doesn't support
   * OAuth. Callers narrow with a plain `if (integration.oauth)` check instead
   * of a runtime type guard.
   */
  readonly oauth: IOAuthIntegration | null;

  /**
   * Initialize the integration with configuration
   */
  initialize(config: Record<string, unknown>): Promise<void>;

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
   * Subscribe to integration events
   */
  on(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * Unsubscribe from integration events
   */
  off(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * How this integration should be treated when a dependency becomes
   * unusable. BaseIntegration defaults it to STOP; integrations that can
   * safely keep running override it.
   */
  readonly dependencyFailurePolicy: DependencyFailurePolicy;

  /**
   * Get integration dependencies (optional)
   *
   * Returns the integrations that must be CONNECTED before this one can
   * start, as references rather than names. Implementations return the very
   * instances they already take in their constructor, so the declared graph
   * cannot drift out of sync with the injected one and a misspelled
   * dependency is a compile error instead of a runtime lookup failure.
   *
   * @returns The depended-on integrations, or undefined if there are none
   */
  getDependencies?(): IIntegration[];

  /**
   * Get the logical group this integration belongs to, for grouping related
   * integrations in the frontend (optional)
   * @returns IntegrationGroup, or undefined if this integration doesn't belong to a group
   */
  getGroup?(): IntegrationGroup;

  /**
   * Get error message if status is ERROR (optional)
   * @returns Error message string, or undefined if no error
   */
  getErrorMessage?(): string | undefined;

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
