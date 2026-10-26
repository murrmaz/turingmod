import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type VerifyClientCallbackAsync, WebSocketServer as WSServer } from 'ws';
import type { Logger } from '../utils/Logger.js';

/**
 * The plumbing both WebSocket endpoints (WS_PATH and TRPC_PATH) share: who may connect, how an
 * upgrade reaches an endpoint, and how an endpoint closes.
 */

/** How long a console gets to close its connection at shutdown before it's cut off. */
const CLOSE_GRACE_MS = 1000;

/**
 * Let only the console open a WebSocket connection. Browsers don't apply same-origin
 * restrictions to WebSocket connections, so without this check any page open in the streamer's
 * browser, whichever site served it, could connect and drive TuringMod (cross-site WebSocket
 * hijacking). Binding to localhost does not prevent this.
 */
export function allowOnlyOrigins(
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

/** An endpoint's server: given its upgrades by HttpServer, open only to the console. */
export function createConsoleWss(allowedOrigins: readonly string[], logger: Logger): WSServer {
  return new WSServer({ noServer: true, verifyClient: allowOnlyOrigins(allowedOrigins, logger) });
}

/**
 * Answer an upgrade request with an HTTP error and close its socket. The socket gets its own
 * error handler: Node stops handling errors on a socket once it's handed over for an upgrade, so
 * a client resetting the connection here would otherwise crash the process.
 */
export function rejectUpgrade(socket: Duplex, status: 404 | 503, reason: string): void {
  socket.on('error', () => socket.destroy());
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
}

/** Hand an upgrade to an endpoint's server, or refuse it while the endpoint isn't running. */
export function upgradeInto(
  wss: WSServer | null,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  if (!wss) {
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
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
