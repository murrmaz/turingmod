import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { type IntegrationInfo, IntegrationStatus, TRPC_PATH } from '@turingmod/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { EventBus } from '../../core/EventBus.js';
import type { IntegrationManager } from '../../integrations/IntegrationManager.js';
import type { OAuthFlowService } from '../../integrations/OAuthFlowService.js';
import { Logger } from '../../utils/Logger.js';
import { HttpServer } from '../HttpServer.js';
import type { AppRouter } from './appRouter.js';
import { createIntegrationsRouter } from './integrationsRouter.js';
import { closeConsoleWss, TrpcServer } from './TrpcServer.js';
import { procedure, router } from './trpc.js';

const CONSOLE = 'http://localhost:3000';
const logger = new Logger({ level: 'silent' });
const obs: IntegrationInfo = {
  name: 'obs',
  status: IntegrationStatus.CONNECTED,
  enabled: true,
  metadata: { dependencies: [] },
};

describe('TrpcServer', () => {
  let stop: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  /**
   * The tRPC endpoint on a real HTTP server. What's tested is the endpoint, not the areas, so its
   * router has only integrations, over a fake integration manager.
   */
  async function start() {
    const manager = {
      getAllStatuses: () => [obs],
      enableIntegration: vi.fn(() => Promise.resolve()),
    };
    const appRouter = router({
      integrations: createIntegrationsRouter(
        manager as unknown as IntegrationManager,
        new EventBus(logger),
        logger
      ),
      /** What the context says about the console, for the test below. */
      consoleOrigin: procedure.query(({ ctx }) => ctx.consoleOrigin),
    });

    const trpc = new TrpcServer(appRouter as unknown as AppRouter, [CONSOLE], logger);
    const oauthFlow = { getCallbackRoutes: () => [] } as unknown as OAuthFlowService;
    const http = new HttpServer(0, '127.0.0.1', '/nonexistent', oauthFlow, logger);
    trpc.start();
    http.routeUpgrades(TRPC_PATH, trpc);
    await http.start();
    stop = async () => {
      await trpc.stop();
      await http.stop();
    };
    const { port } = http.getServer().address() as AddressInfo;
    return { manager, base: `ws://127.0.0.1:${port}` };
  }

  /** Open a socket as a page from `origin` would; resolves with it open, or rejects. */
  function connect(url: string, origin: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { origin });
      socket.once('open', () => resolve(socket));
      socket.once('unexpected-response', (_request, response) =>
        reject(new Error(`HTTP ${response.statusCode}`))
      );
      socket.once('error', reject);
    });
  }

  /** The next message on `socket` that answers request `id`. */
  function reply(socket: WebSocket, id: number): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const onMessage = (data: Buffer) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        const result = message.result as { type?: string } | undefined;
        if (message.id === id && result?.type !== 'started') {
          socket.off('message', onMessage);
          resolve(message);
        }
      };
      socket.on('message', onMessage);
    });
  }

  it('runs a mutation for the console', async () => {
    const { manager, base } = await start();
    const socket = await connect(`${base}${TRPC_PATH}`, CONSOLE);

    const answer = reply(socket, 1);
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'mutation',
        params: { path: 'integrations.start', input: { integrationName: 'obs' } },
      })
    );

    expect(await answer).toMatchObject({ id: 1, result: { type: 'data' } });
    expect(manager.enableIntegration).toHaveBeenCalledWith('obs');
    socket.close();
  });

  it('sends the integrations as soon as the console subscribes', async () => {
    const { base } = await start();
    const socket = await connect(`${base}${TRPC_PATH}`, CONSOLE);

    const first = reply(socket, 1);
    socket.send(
      JSON.stringify({ id: 1, method: 'subscription', params: { path: 'integrations.watch' } })
    );

    expect(await first).toMatchObject({ result: { type: 'data', data: [obs] } });
    socket.close();
  });

  it("tells procedures the console's origin, from its connection", async () => {
    const { base } = await start();
    const socket = await connect(`${base}${TRPC_PATH}`, CONSOLE);

    const answer = reply(socket, 1);
    socket.send(JSON.stringify({ id: 1, method: 'query', params: { path: 'consoleOrigin' } }));

    expect(await answer).toMatchObject({ result: { type: 'data', data: CONSOLE } });
    socket.close();
  });

  it('refuses a page from any other origin', async () => {
    const { base } = await start();

    await expect(connect(`${base}${TRPC_PATH}`, 'https://example.com')).rejects.toThrow('HTTP 403');
  });

  it('refuses an upgrade on a path no endpoint is routed to', async () => {
    const { base } = await start();

    await expect(connect(`${base}/elsewhere`, CONSOLE)).rejects.toThrow('HTTP 404');
  });
});

describe('closeConsoleWss', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts off a console that never completes the closing handshake', async () => {
    vi.useFakeTimers();
    const clients = new Set<{ close: () => void; terminate: () => void }>();
    let closed: (() => void) | undefined;
    const unresponsive = {
      close: vi.fn(),
      terminate: vi.fn(() => {
        clients.delete(unresponsive);
        closed?.();
      }),
    };
    clients.add(unresponsive);
    // As ws does: the server's close completes once every client is gone.
    const wss = {
      clients,
      close: (callback: () => void) => {
        closed = callback;
      },
    } as unknown as WebSocketServer;

    const stopping = closeConsoleWss(wss);
    expect(unresponsive.close).toHaveBeenCalled();
    expect(unresponsive.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    await stopping;
    expect(unresponsive.terminate).toHaveBeenCalled();
  });
});
