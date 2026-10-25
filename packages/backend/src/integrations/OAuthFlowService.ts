import { randomUUID } from 'node:crypto';
import { messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { IntegrationManager } from './IntegrationManager.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

/** What the provider's redirect to a callback route carried. */
export interface OAuthCallbackParams {
  code: string | null;
  state: string | null;
  /** The provider's error, e.g. `access_denied` when the streamer refused. */
  error: string | null;
  errorDescription: string | null;
}

/**
 * How a callback went, for the page the provider's redirect lands on. `consoleOrigin` is the
 * console that asked to authorize, to send the streamer back to; null if it isn't known.
 */
export type OAuthCallbackOutcome =
  | { result: 'connected'; consoleOrigin: string | null }
  | { result: 'failed'; message: string; consoleOrigin: string | null }
  | { result: 'invalid' };

/**
 * The OAuth authorization-code flow for every OAuth-capable integration: building the
 * authorization URL, tracking the `state` it was issued with, and completing the callback by
 * exchanging the code here, so it never depends on a console still being open or connected.
 * Which integrations take part is derived from their `oauth` getter, so a new provider needs
 * nothing here.
 */
@singleton()
export class OAuthFlowService {
  private static readonly STATE_TTL_MS = 10 * 60 * 1000;

  /**
   * OAuth `state` -> the flow it was issued for. Single-use and TTL-bounded, so a callback is
   * accepted only for an authorization this server started, once, for that integration.
   */
  private pendingStates = new Map<
    string,
    { integrationName: string; consoleOrigin: string | null; expiresAt: number }
  >();

  constructor(
    private integrationManager: IntegrationManager,
    private eventBus: EventBus
  ) {}

  /**
   * Get the OAuth callback path for every OAuth-capable registered
   * integration, so callers (e.g. HttpServer) get plain routing data instead of
   * live integration instances they have no business holding onto. Throws if
   * two integrations claim one path, since only one of them could be reached.
   */
  getCallbackRoutes(): Array<{ path: string; integrationName: string }> {
    const routes: Array<{ path: string; integrationName: string }> = [];

    for (const integration of this.integrationManager.getAllIntegrations()) {
      if (!integration.oauth) continue;
      const path = integration.oauth.getCallbackPath();
      const conflict = routes.find((route) => route.path === path);
      if (conflict) {
        throw new Error(
          `OAuth callback path conflict: '${path}' is claimed by both '${conflict.integrationName}' and '${integration.name}'`
        );
      }
      routes.push({ path, integrationName: integration.name });
    }

    return routes;
  }

  /**
   * Build the OAuth authorization URL for an integration from its configured
   * client credentials. The same credentials then exchange the code, since
   * both come from the integration itself. Required scopes always come from
   * the integration, never the caller. `consoleOrigin` is where the callback
   * page sends the streamer back to.
   */
  getAuthorizationUrl(name: string, consoleOrigin: string | null): string {
    const integration = this.getOAuthIntegration(name);
    if (!integration.isConfigured()) {
      throw new Error(`${name} has no client credentials; set them up in the console first`);
    }
    const state = this.createState(name, consoleOrigin);
    return integration.getAuthorizationUrl(state);
  }

  /**
   * Complete an authorization from the provider's redirect to its callback route: check the
   * `state`, then exchange the code (enabling and starting the integration) or take the
   * provider's error. Every outcome but an invalid `state` is announced as `oauth.completed`,
   * which reaches every open console, before this returns.
   */
  async handleCallback(
    integrationName: string,
    params: OAuthCallbackParams
  ): Promise<OAuthCallbackOutcome> {
    const flow = this.consumeState(integrationName, params.state);
    if (!flow) {
      // Not an authorization this server started (or no longer): nothing to tell anyone.
      return { result: 'invalid' };
    }
    const { consoleOrigin } = flow;

    if (params.error) {
      const message = params.errorDescription
        ? `${params.error}: ${params.errorDescription}`
        : params.error;
      return this.fail(integrationName, message, consoleOrigin);
    }
    if (!params.code) {
      return this.fail(integrationName, 'The provider sent no authorization code', consoleOrigin);
    }

    try {
      const integration = this.getOAuthIntegration(integrationName);
      await integration.exchangeCode(params.code);
      // Authorizing an integration is the streamer asking for it to run.
      await this.integrationManager.enableIntegration(integrationName);
    } catch (error) {
      return this.fail(integrationName, messageOf(error), consoleOrigin);
    }
    await this.eventBus.emit('oauth.completed', { integrationName, success: true });
    return { result: 'connected', consoleOrigin };
  }

  private async fail(
    integrationName: string,
    message: string,
    consoleOrigin: string | null
  ): Promise<OAuthCallbackOutcome> {
    await this.eventBus.emit('oauth.completed', {
      integrationName,
      success: false,
      errorMessage: message,
    });
    return { result: 'failed', message, consoleOrigin };
  }

  /**
   * Take a `state` value from a callback: valid only once, only for the integration it was
   * issued for, and only within its TTL. Null if it is missing, expired, reused, or for the
   * wrong integration.
   */
  private consumeState(
    integrationName: string,
    state: string | null
  ): { consoleOrigin: string | null } | null {
    if (!state) {
      return null;
    }

    const entry = this.pendingStates.get(state);
    this.pendingStates.delete(state);

    if (!entry || entry.expiresAt <= Date.now() || entry.integrationName !== integrationName) {
      return null;
    }

    return { consoleOrigin: entry.consoleOrigin };
  }

  /**
   * Look up an integration and confirm it supports the OAuth flow
   */
  private getOAuthIntegration(name: string): IOAuthIntegration {
    const integration = this.integrationManager.getIntegration(name);
    if (!integration) {
      throw new Error(`Integration not found: ${name}`);
    }

    if (!integration.oauth) {
      throw new Error(`Integration does not support OAuth: ${name}`);
    }

    return integration.oauth;
  }

  /**
   * Record a pending OAuth flow and return the single-use `state` value to
   * send to the provider.
   */
  private createState(integrationName: string, consoleOrigin: string | null): string {
    this.pruneExpiredStates();

    const state = randomUUID();
    this.pendingStates.set(state, {
      integrationName,
      consoleOrigin,
      expiresAt: Date.now() + OAuthFlowService.STATE_TTL_MS,
    });

    return state;
  }

  private pruneExpiredStates(): void {
    const now = Date.now();
    for (const [state, entry] of this.pendingStates) {
      if (entry.expiresAt <= now) {
        this.pendingStates.delete(state);
      }
    }
  }
}
