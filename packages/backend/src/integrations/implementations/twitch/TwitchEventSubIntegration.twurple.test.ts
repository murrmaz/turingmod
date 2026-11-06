import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { IntegrationStatus } from '@turingmod/shared';
import { ApiClient, type HelixUser, type HelixUserApi } from '@twurple/api';
import type { RefreshingAuthProvider } from '@twurple/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { EventBus } from '../../../core/EventBus.js';
import { fake } from '../../../testing.js';
import { Logger } from '../../../utils/Logger.js';
import type { TwitchApiIntegration } from './TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from './TwitchAuthIntegration.js';
import { TwitchEventSubIntegration } from './TwitchEventSubIntegration.js';

const USER_ID = '1';

/** Every request but those to the fake Twitch fails, so this test can't reach the real one. */
const realFetch = globalThis.fetch;
function refuseAnythingNotLocal() {
  vi.stubGlobal('fetch', (...[input, init]: Parameters<typeof fetch>) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('http://localhost:')) {
      throw new Error(`This test tried to reach ${url}`);
    }
    return realFetch(input, init);
  });
}

/** Grants everything, so the only thing that can refuse a subscription is the fake Twitch. */
const authProvider = fake<RefreshingAuthProvider>()({
  clientId: 'client',
  authorizationType: 'bearer',
  getCurrentScopesForUser: () => ['*'],
  getAnyAccessToken: async () => accessToken(),
  getAccessTokenForUser: async () => accessToken(),
  getAccessTokenForIntent: async () => accessToken(),
  getAppAccessToken: async () => accessToken(),
  refreshAccessTokenForUser: async () => accessToken(),
});

function accessToken() {
  return {
    accessToken: 'token',
    refreshToken: null,
    scope: ['*'],
    expiresIn: null,
    obtainmentTimestamp: Date.now(),
    userId: USER_ID,
  };
}

/**
 * Against the real Twurple listener, over a real socket, since the integration's status rests on
 * what Twurple does and when: a stand-in would only repeat what this file's sibling assumes.
 */
describe('TwitchEventSubIntegration on the real Twurple listener', () => {
  let sockets: WebSocketServer;
  let helix: Server;
  let refuse: (type: string) => boolean;
  let withRateLimitHeaders: boolean;
  /** Each subscription request's topic. */
  let subscribeRequests: string[];
  /** The socket session each of those asked for, in the same order. */
  let subscribeSessions: string[];
  let integration: TwitchEventSubIntegration;
  let session: number;

  beforeEach(async () => {
    refuse = () => false;
    withRateLimitHeaders = true;
    subscribeRequests = [];
    subscribeSessions = [];
    session = 0;
    helix = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        const { type, version, condition, transport } = JSON.parse(body);
        subscribeRequests.push(type);
        subscribeSessions.push(transport.session_id);
        response.setHeader('Content-Type', 'application/json');
        if (withRateLimitHeaders) {
          response.setHeader('Ratelimit-Limit', '800');
          response.setHeader('Ratelimit-Remaining', '799');
          response.setHeader('Ratelimit-Reset', String(Math.floor(Date.now() / 1000) + 60));
        }
        if (refuse(type)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Forbidden', status: 403, message: 'no' }));
          return;
        }
        response.statusCode = 202;
        response.end(
          JSON.stringify({
            data: [
              {
                id: `${type}-${session}`,
                status: 'enabled',
                type,
                version,
                condition,
                created_at: new Date().toISOString(),
                transport,
                cost: 0,
              },
            ],
            total: 0,
            total_cost: 0,
            max_total_cost: 100,
          })
        );
      });
    });
    // With TWURPLE_MOCK_API_PORT set, Twurple's API calls and its socket both come to this one port.
    sockets = new WebSocketServer({ server: helix, path: '/ws' });
    sockets.on('connection', (socket) => {
      session += 1;
      socket.send(
        JSON.stringify({
          metadata: { message_type: 'session_welcome' },
          payload: { session: { id: `session-${session}`, keepalive_timeout_seconds: 30 } },
        })
      );
    });
    await new Promise<void>((done) => helix.listen(0, 'localhost', done));

    refuseAnythingNotLocal();
    vi.stubEnv('TWURPLE_MOCK_API_PORT', String((helix.address() as AddressInfo).port));
    const apiClient = new ApiClient({ authProvider });
    integration = new TwitchEventSubIntegration(
      new EventBus(new Logger({ level: 'silent' })),
      new Logger({ level: 'silent' }),
      fake<TwitchAuthIntegration>()({
        getAuthProvider: () => authProvider,
        getAuthenticatedUserId: () => USER_ID,
      }),
      fake<TwitchApiIntegration>()({
        getApiClient: () => apiClient,
        // Runs the call as the real one does, on a client that knows the one user it's asked for.
        request: <T>(call: (client: ApiClient) => Promise<T>) =>
          call(
            fake<ApiClient>()({
              users: fake<HelixUserApi>()({
                getUserById: async () => fake<HelixUser>()({ id: USER_ID, displayName: 'B' }),
              }),
            })
          ),
      })
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await integration.stop();
    for (const client of sockets.clients) {
      client.terminate();
    }
    await new Promise((done) => sockets.close(done));
    helix.closeAllConnections();
    await new Promise((done) => helix.close(done));
  });

  const statusBecomes = (status: IntegrationStatus) =>
    vi.waitFor(() => expect(integration.getStatus()).toBe(status), { timeout: 5000 });

  it('reports connecting from start() until Twitch has accepted every topic', async () => {
    await integration.start();
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);

    await statusBecomes(IntegrationStatus.CONNECTED);

    expect(subscribeRequests).toHaveLength(9);
  });

  it('reports a refused topic by name, keeping those that were accepted', async () => {
    refuse = (type) => type === 'channel.chat.message';

    await integration.start();
    await statusBecomes(IntegrationStatus.ERROR);

    expect(integration.getErrorMessage()).toContain('channel.chat.message');
    expect(integration.getErrorMessage()).not.toContain('channel.follow');
  });

  it('reports a refusal even when Twurple then holds back the other requests', async () => {
    refuse = () => true;
    withRateLimitHeaders = false;

    await integration.start();
    await statusBecomes(IntegrationStatus.ERROR);

    expect(subscribeRequests).toHaveLength(1); // the rest are waiting in Twurple's rate limiter
  });

  it('subscribes again on a new socket after a drop, and recovers from a refusal', async () => {
    refuse = (type) => type === 'channel.chat.message';
    await integration.start();
    await statusBecomes(IntegrationStatus.ERROR);

    refuse = () => false;
    const statuses: IntegrationStatus[] = [];
    integration.on('status', (status) => statuses.push(status));
    for (const client of sockets.clients) {
      client.terminate();
    }

    await statusBecomes(IntegrationStatus.CONNECTED);
    expect(statuses).toEqual([IntegrationStatus.CONNECTING, IntegrationStatus.CONNECTED]);
    // Counted by session: ERROR comes with the first refusal, so the first socket's other requests
    // can still be arriving after the drop.
    await vi.waitFor(
      () => expect(subscribeSessions.filter((id) => id === `session-${session}`)).toHaveLength(9),
      { timeout: 5000 }
    );
  });

  it('retries on a fresh listener, with the old socket closed', async () => {
    await integration.start();
    await statusBecomes(IntegrationStatus.CONNECTED);

    await integration.start();
    await statusBecomes(IntegrationStatus.CONNECTED);

    await vi.waitFor(() => expect(sockets.clients.size).toBe(1), { timeout: 5000 });
  });

  it('stays disconnected after stopping', async () => {
    await integration.start();
    await statusBecomes(IntegrationStatus.CONNECTED);

    await integration.stop();
    await new Promise((done) => setTimeout(done, 100));

    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });
});
