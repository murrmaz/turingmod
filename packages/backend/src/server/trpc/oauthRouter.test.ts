import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { OAuthFlowService } from '../../integrations/OAuthFlowService.js';
import { Logger } from '../../utils/Logger.js';
import { createOAuthRouter } from './oauthRouter.js';
import { createCallerFactory } from './trpc.js';

const logger = new Logger({ level: 'silent' });

function setup(consoleOrigin: string | null) {
  const eventBus = new EventBus(logger);
  const oauthFlow = { getAuthorizationUrl: vi.fn(() => 'https://id.twitch.tv/authorize?state=s') };
  const controller = new AbortController();
  const caller = createCallerFactory(
    createOAuthRouter(oauthFlow as unknown as OAuthFlowService, eventBus, logger)
  )({ consoleOrigin }, { signal: controller.signal });
  return { caller, controller, eventBus, oauthFlow };
}

describe('oauth router', () => {
  it("hands out the authorization URL, keeping the asking console's origin with the attempt", async () => {
    const { caller, oauthFlow } = setup('http://localhost:3000');

    expect(await caller.authorizationUrl({ integrationName: 'twitch-auth' })).toBe(
      'https://id.twitch.tv/authorize?state=s'
    );
    expect(oauthFlow.getAuthorizationUrl).toHaveBeenCalledWith(
      'twitch-auth',
      'http://localhost:3000'
    );
  });

  it('sends each authorization result as it happens', async () => {
    const { caller, controller, eventBus } = setup(null);
    const results = (await caller.results())[Symbol.asyncIterator]();

    const next = results.next();
    await eventBus.emit('oauth.completed', {
      integrationName: 'spotify-auth',
      success: false,
      errorMessage: 'access_denied',
    });

    expect((await next).value).toEqual({
      integrationName: 'spotify-auth',
      success: false,
      errorMessage: 'access_denied',
    });
    controller.abort();
  });
});
