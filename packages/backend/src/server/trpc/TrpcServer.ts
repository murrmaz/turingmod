import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { type VerifyClientCallbackAsync, WebSocketServer as WSServer } from 'ws';
import type { Logger } from '../../utils/Logger.js';
import { rejectUpgrade, type UpgradeHandler } from '../HttpServer.js';
import type { AppRouter } from './appRouter.js';

/** How long a console gets to close its connection at shutdown before it's cut off. */
const CLOSE_GRACE_MS = 1000;

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
    const wss = new WSServer({
      noServer: true,
      verifyClient: allowOnlyOrigins(this.allowedOrigins, this.logger),
    });
    applyWSSHandler({
      wss,
      router: this.appRouter,
      // Read once per connection; verifyClient has already allowed the origin.
      createContext: ({ req }) => ({ consoleOrigin: req.headers.origin ?? null }),
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

  /** Take an upgrade HttpServer hands over, or refuse it while stopped. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const wss = this.wss;
    if (!wss) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
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

/**
 * Let only the console open a WebSocket connection. Browsers don't apply same-origin
 * restrictions to WebSocket connections, so without this check any page open in the streamer's
 * browser, whichever site served it, could connect and drive TuringMod (cross-site WebSocket
 * hijacking). Binding to localhost does not prevent this.
 */
function allowOnlyOrigins(
  allowedOrigins: readonly string[],
  logger: Logger
): VerifyClientCallbackAsync {
  return ({ origin }, callback) => {
    if (origin && allowedOrigins.includes(origin)) {
      callback(true);
      return;
    }
    logger.warn('Rejected WebSocket connection: disallowed origin', { origin });
    callback(false, 403, 'Forbidden');
  };
}

/**
 * Close every connection and the server. A console that doesn't complete the closing handshake
 * (a sleeping laptop, a frozen tab) is cut off after CLOSE_GRACE_MS, so it can't hold up
 * shutdown.
 */
export async function closeConsoleWss(wss: WSServer): Promise<void> {
  for (const client of wss.clients) {
    client.close();
  }
  const cutOff = setTimeout(() => {
    for (const client of wss.clients) {
      client.terminate();
    }
  }, CLOSE_GRACE_MS);
  try {
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  } finally {
    clearTimeout(cutOff);
  }
}
