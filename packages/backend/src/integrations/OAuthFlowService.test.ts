import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../core/EventBus.js';
import type { IntegrationManager } from './IntegrationManager.js';
import type { IIntegration } from './interfaces/IIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';
import { OAuthFlowService } from './OAuthFlowService.js';

/** An OAuth integration whose authorization URL is just the state it was given. */
function oauthIntegration(name: string, callbackPath: string): IOAuthIntegration {
  const integration = {
    name,
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
  const Console = 'http://localhost:3000';
  let twitch: IOAuthIntegration;
  let spotify: IOAuthIntegration;
  let manager: IntegrationManager;
  let emit: ReturnType<typeof vi.fn>;
  let flow: OAuthFlowService;

  /** A callback with this state and code, as the provider's redirect would carry them. */
  const callback = (
    name: string,
    state: string | null,
    extra: Partial<{ code: string | null; error: string; errorDescription: string }> = {}
  ) =>
    flow.handleCallback(name, {
      code: 'the-code',
      state,
      error: null,
      errorDescription: null,
      ...extra,
    });

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
    emit = vi.fn().mockResolvedValue(undefined);
    flow = new OAuthFlowService(manager, { emit } as unknown as EventBus);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exchanges the code, enables the integration and announces it', async () => {
    const state = flow.getAuthorizationUrl('twitch-auth', Console);

    const outcome = await callback('twitch-auth', state);

    expect(outcome).toEqual({ result: 'connected', consoleOrigin: Console });
    expect(twitch.exchangeCode).toHaveBeenCalledWith('the-code');
    expect(manager.enableIntegration).toHaveBeenCalledWith('twitch-auth');
    expect(emit).toHaveBeenCalledWith('oauth.completed', {
      integrationName: 'twitch-auth',
      success: true,
    });
  });

  it('reports a failed exchange, without enabling the integration', async () => {
    vi.mocked(twitch.exchangeCode).mockRejectedValue(new Error('invalid client'));
    const state = flow.getAuthorizationUrl('twitch-auth', Console);

    const outcome = await callback('twitch-auth', state);

    expect(outcome).toEqual({
      result: 'failed',
      message: 'invalid client',
      consoleOrigin: Console,
    });
    expect(manager.enableIntegration).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('oauth.completed', {
      integrationName: 'twitch-auth',
      success: false,
      errorMessage: 'invalid client',
    });
  });

  it("reports the provider's error, such as the streamer denying access", async () => {
    const state = flow.getAuthorizationUrl('spotify-auth', null);

    const outcome = await callback('spotify-auth', state, {
      code: null,
      error: 'access_denied',
      errorDescription: 'The user denied the request',
    });

    expect(outcome).toEqual({
      result: 'failed',
      message: 'access_denied: The user denied the request',
      consoleOrigin: null,
    });
    expect(spotify.exchangeCode).not.toHaveBeenCalled();
  });

  it('accepts a state only once', async () => {
    const state = flow.getAuthorizationUrl('twitch-auth', Console);
    await callback('twitch-auth', state);

    expect(await callback('twitch-auth', state)).toEqual({ result: 'invalid' });
    expect(twitch.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('rejects a state issued for another integration, and burns it', async () => {
    const state = flow.getAuthorizationUrl('spotify-auth', Console);

    expect(await callback('twitch-auth', state)).toEqual({ result: 'invalid' });
    expect(await callback('spotify-auth', state)).toEqual({ result: 'invalid' });
  });

  it('rejects a state after ten minutes', async () => {
    vi.useFakeTimers();
    const state = flow.getAuthorizationUrl('twitch-auth', Console);

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(await callback('twitch-auth', state)).toEqual({ result: 'invalid' });
  });

  it('rejects a missing or unknown state, exchanging and announcing nothing', async () => {
    expect(await callback('twitch-auth', null)).toEqual({ result: 'invalid' });
    expect(await callback('twitch-auth', 'made-up')).toEqual({ result: 'invalid' });
    expect(twitch.exchangeCode).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('refuses an integration without OAuth', () => {
    expect(() => flow.getAuthorizationUrl('obs', Console)).toThrow(
      'Integration does not support OAuth: obs'
    );
  });

  it('refuses an integration whose client credentials are not set up', () => {
    vi.spyOn(twitch, 'isConfigured').mockReturnValue(false);

    expect(() => flow.getAuthorizationUrl('twitch-auth', Console)).toThrow(
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
    const clashing = new OAuthFlowService(
      { getAllIntegrations: () => all } as unknown as IntegrationManager,
      { emit } as unknown as EventBus
    );

    expect(() => clashing.getCallbackRoutes()).toThrow(
      /claimed by both 'twitch-auth' and 'other-auth'/
    );
  });
});
