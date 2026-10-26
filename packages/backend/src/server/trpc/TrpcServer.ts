import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import type { WebSocketServer as WSServer } from 'ws';
import type { Logger } from '../../utils/Logger.js';
import { closeConsoleWss, createConsoleWss, upgradeInto } from '../consoleSockets.js';
import type { UpgradeHandler } from '../HttpServer.js';
import type { AppRouter } from './appRouter.js';

/**
 * The tRPC endpoint (TRPC_PATH): serves the app router over WebSocket, to the console only.
 * HttpServer hands it the upgrade requests for its path.
 */
export class TrpcServer implements UpgradeHandler {
  private wss: WSServer | null = null;
  private logger: Logger;

  constructor(
    private appRouter: AppRouter,
    private allowedOrigins: string[],
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'TrpcServer' });
  }

  start(): void {
    const wss = createConsoleWss(this.allowedOrigins, this.logger);
    applyWSSHandler({
      wss,
      router: this.appRouter,
      onError: ({ path, error }) => {
        // A malformed input is the console's mistake; anything else is a procedure failing.
        if (error.code === 'BAD_REQUEST') {
          this.logger.warn(`Rejected ${path ?? 'a request'}: ${error.message}`);
        } else {
          this.logger.error(`${path ?? 'A request'} failed`, error.cause ?? error);
        }
      },
    });
    this.wss = wss;
    this.logger.info('tRPC server started');
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    upgradeInto(this.wss, request, socket, head);
  }

  /** Close every connection, which ends their subscriptions, and stop accepting new ones. */
  async stop(): Promise<void> {
    const wss = this.wss;
    if (!wss) {
      return;
    }
    this.wss = null;
    await closeConsoleWss(wss);
    this.logger.info('tRPC server stopped');
  }
}
