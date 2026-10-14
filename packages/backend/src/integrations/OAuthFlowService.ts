import { randomUUID } from 'node:crypto';
import { singleton } from 'tsyringe';
import { IntegrationManager } from './IntegrationManager.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

/**
 * The OAuth authorization-code flow for every OAuth-capable integration: building the
 * authorization URL, tracking the `state` it was issued with, routing the callback back to the
 * client that started it, and exchanging the code. Which integrations take part is derived from
 * their `oauth` getter, so a new provider needs nothing here.
 */
@singleton()
export class OAuthFlowService {
  private static readonly STATE_TTL_MS = 10 * 60 * 1000;

  /**
   * OAuth `state` -> the client/integration that started the flow. Lets the
   * HTTP callback (which has no WebSocket identity of its own) find out
   * which client to send the authorization code back to, instead of
   * broadcasting it to every connected client. Single-use, TTL-bounded.
   */
  private pendingStates = new Map<
    string,
    { integrationName: string; clientId: string; expiresAt: number }
  >();

  constructor(private integrationManager: IntegrationManager) {}

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
   * the integration, never the caller.
   */
  getAuthorizationUrl(name: string, clientId: string): string {
    const integration = this.getOAuthIntegration(name);
    if (!integration.isConfigured()) {
      throw new Error(`${name} has no client credentials; set them up in the console first`);
    }
    const state = this.createState(name, clientId);
    return integration.getAuthorizationUrl(state);
  }

  /**
   * Consume a `state` value from the OAuth callback: valid only once, only
   * for the integration it was issued for, and only within its TTL. Returns
   * the clientId to route the authorization code back to, or null if the
   * state is missing, expired, reused, or for the wrong integration.
   */
  consumeState(integrationName: string, state: string | null): string | null {
    if (!state) {
      return null;
    }

    const entry = this.pendingStates.get(state);
    this.pendingStates.delete(state);

    if (!entry || entry.expiresAt <= Date.now() || entry.integrationName !== integrationName) {
      return null;
    }

    return entry.clientId;
  }

  /**
   * Exchange an OAuth authorization code for tokens, then enable and start
   * the integration: authorizing it is the streamer asking for it to run.
   */
  async completeExchange(name: string, code: string): Promise<void> {
    const integration = this.getOAuthIntegration(name);
    await integration.exchangeCode(code);
    await this.integrationManager.enableIntegration(name);
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
  private createState(integrationName: string, clientId: string): string {
    this.pruneExpiredStates();

    const state = randomUUID();
    this.pendingStates.set(state, {
      integrationName,
      clientId,
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
