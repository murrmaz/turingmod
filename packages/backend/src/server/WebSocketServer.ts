import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IWebSocketMessage } from '@turingmod/shared';
import { createErrorMessage, messageOf, WebSocketMessageSchema } from '@turingmod/shared';
import { WebSocket, type WebSocketServer as WSServer } from 'ws';
import { z } from 'zod';
import type { Logger } from '../utils/Logger.js';
import { closeConsoleWss, createConsoleWss, upgradeInto } from './consoleSockets.js';
import type { UpgradeHandler } from './HttpServer.js';
import type { MessageRouter } from './MessageRouter.js';

/**
 * WebSocket server (WS_PATH)
 * Handles WebSocket connections and message routing. HttpServer hands it the upgrade requests
 * for its path.
 */
export class WebSocketServer implements UpgradeHandler {
  private wss: WSServer | null = null;
  private clients = new Map<string, WebSocket>();
  /** Each connected client's Origin header, which verifyClient has already allowed. */
  private origins = new Map<string, string>();
  private logger: Logger;

  constructor(
    private messageRouter: MessageRouter,
    /** Origins allowed to open a WebSocket connection (see allowOnlyOrigins). */
    private allowedOrigins: string[],
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'WebSocketServer' });
  }

  /**
   * Start the WebSocket server
   */
  start(): void {
    this.logger.debug('Starting WebSocket server', { allowedOrigins: this.allowedOrigins });

    this.wss = createConsoleWss(this.allowedOrigins, this.logger);

    this.wss.on('connection', (ws: WebSocket, request) => {
      this.handleConnection(ws, request.headers.origin);
    });

    this.logger.info('WebSocket server started');
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    upgradeInto(this.wss, request, socket, head);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, origin: string | undefined): void {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, ws);
    if (origin) {
      this.origins.set(clientId, origin);
    }

    this.logger.debug('Client connected', { clientId, total: this.clients.size });

    // Set up event handlers
    ws.on('message', (data: Buffer) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      this.handleDisconnection(clientId);
    });

    ws.on('error', (error: Error) => {
      this.logger.error('WebSocket error', error, { clientId });
    });
  }

  /**
   * Handle incoming message from client
   */
  private async handleMessage(clientId: string, data: Buffer): Promise<void> {
    try {
      const envelope = WebSocketMessageSchema.safeParse(JSON.parse(data.toString()));
      if (!envelope.success) {
        this.logger.warn('Rejected a malformed message', {
          clientId,
          issues: envelope.error.issues,
        });
        this.sendToClient(
          clientId,
          createErrorMessage(
            'MESSAGE_HANDLING_ERROR',
            `Malformed message: ${z.prettifyError(envelope.error)}`
          )
        );
        return;
      }
      const message = envelope.data;

      this.logger.debug('Received message', {
        clientId,
        type: message.type,
        id: message.id,
      });

      // Route message to appropriate handler
      const response = await this.messageRouter.route(message, clientId);

      // Send response if provided
      if (response) {
        this.sendToClient(clientId, response);
      }
    } catch (error) {
      this.logger.error('Failed to handle message', error, { clientId });

      // Send error response
      this.sendToClient(clientId, createErrorMessage('MESSAGE_HANDLING_ERROR', messageOf(error)));
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string): void {
    this.clients.delete(clientId);
    this.origins.delete(clientId);
    this.logger.debug('Client disconnected', { clientId, total: this.clients.size });
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: IWebSocketMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send to client: not connected', { clientId });
      return;
    }

    try {
      client.send(JSON.stringify(message));
      this.logger.debug('Sent message to client', {
        clientId,
        type: message.type,
      });
    } catch (error) {
      this.logger.error('Failed to send message to client', error, { clientId });
    }
  }

  /** The origin (e.g. `http://localhost:3000`) of the console behind a client, if it's connected. */
  originOf(clientId: string): string | null {
    return this.origins.get(clientId) ?? null;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: IWebSocketMessage): void {
    const data = JSON.stringify(message);

    for (const [clientId, client] of this.clients.entries()) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          this.logger.error('Failed to broadcast to client', error, { clientId });
        }
      }
    }

    this.logger.debug('Broadcast message', {
      type: message.type,
      clients: this.clients.size,
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping WebSocket server');

    const wss = this.wss;
    this.wss = null;
    if (wss) {
      await closeConsoleWss(wss);
    }
    this.clients.clear();

    this.logger.info('WebSocket server stopped');
  }
}
