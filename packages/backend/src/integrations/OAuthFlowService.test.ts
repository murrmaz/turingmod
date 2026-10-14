import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationManager } from './IntegrationManager.js';
import type { IIntegration } from './interfaces/IIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';
import { OAuthFlowService } from './OAuthFlowService.js';

/** An OAuth integration whose authorization URL is just the state it was given. */
function oauthIntegration(name: string, callbackPath: string): IOAuthIntegration {
  const integration = {
    name,
    getRequiredScopes: () => ['scope'],
    isConfigured: () => true,
    getAuthorizationUrl: (state: string) => state,
    exchangeCode: vi.fn().mockResolvedValue(undefined),
    getCallbackPath: () => callbackPath,
    getRedirectUri: () => `http://localhost:8080${callbackPath}`,
  } as unknown as IOAuthIntegration & { oauth: IOAuthIntegration };
  integration.oauth = integration;
  return integration;
}

describe('OAuthFlowService', () => {
  let twitch: IOAuthIntegration;
  let spotify: IOAuthIntegration;
  let manager: IntegrationManager;
  let flow: OAuthFlowService;

  beforeEach(() => {
    twitch = oauthIntegration('twitch-auth', '/callback/twitch');
    spotify = oauthIntegration('spotify-auth', '/callback/spotify');
    const obs = { name: 'obs', oauth: null } as unknown as IIntegration;
    const all: IIntegration[] = [twitch, spotify, obs];
    manager = {
      getAllIntegrations: () => all,
      getIntegration: (name: string) => all.find((i) => i.name === name) ?? null,
      enableIntegration: vi.fn().mockResolvedValue(undefined),
    } as unknown as IntegrationManager;
    flow = new OAuthFlowService(manager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes a callback back to the client that started the flow', () => {
    const state = flow.getAuthorizationUrl('twitch-auth', 'client-1');

    expect(flow.consumeState('twitch-auth', state)).toBe('client-1');
  });

  it('accepts a state only once', () => {
    const state = flow.getAuthorizationUrl('twitch-auth', 'client-1');
    flow.consumeState('twitch-auth', state);

    expect(flow.consumeState('twitch-auth', state)).toBeNull();
  });

  it('rejects a state issued for another integration, and burns it', () => {
    const state = flow.getAuthorizationUrl('spotify-auth', 'client-1');

    expect(flow.consumeState('twitch-auth', state)).toBeNull();
    expect(flow.consumeState('spotify-auth', state)).toBeNull();
  });

  it('rejects a state after ten minutes', () => {
    vi.useFakeTimers();
    const state = flow.getAuthorizationUrl('twitch-auth', 'client-1');

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(flow.consumeState('twitch-auth', state)).toBeNull();
  });

  it('rejects a missing or unknown state', () => {
    expect(flow.consumeState('twitch-auth', null)).toBeNull();
    expect(flow.consumeState('twitch-auth', 'made-up')).toBeNull();
  });

  it('refuses an integration without OAuth', () => {
    expect(() => flow.getAuthorizationUrl('obs', 'client-1')).toThrow(
      'Integration does not support OAuth: obs'
    );
  });

  it('refuses an integration whose client credentials are not set up', () => {
    vi.spyOn(twitch, 'isConfigured').mockReturnValue(false);

    expect(() => flow.getAuthorizationUrl('twitch-auth', 'client-1')).toThrow(
      'twitch-auth has no client credentials'
    );
  });

  it('lists a callback route for each OAuth integration only', () => {
    expect(flow.getCallbackRoutes()).toEqual([
      { path: '/callback/twitch', integrationName: 'twitch-auth' },
      { path: '/callback/spotify', integrationName: 'spotify-auth' },
    ]);
  });

  it('refuses two integrations claiming one callback path', () => {
    const clash = oauthIntegration('other-auth', '/callback/twitch');
    const all: IIntegration[] = [twitch, clash];
    const clashing = new OAuthFlowService({
      getAllIntegrations: () => all,
    } as unknown as IntegrationManager);

    expect(() => clashing.getCallbackRoutes()).toThrow(
      /claimed by both 'twitch-auth' and 'other-auth'/
    );
  });

  it('enables and starts the integration after exchanging the code', async () => {
    await flow.completeExchange('twitch-auth', 'the-code');

    expect(twitch.exchangeCode).toHaveBeenCalledWith('the-code');
    expect(manager.enableIntegration).toHaveBeenCalledWith('twitch-auth');
  });
});
