import type { Server as HttpServer } from 'node:http';
import type { IWebSocketMessage } from '@turingmod/shared';
import { createErrorMessage, createPongMessage, MessageType } from '@turingmod/shared';
import { WebSocket, WebSocketServer as WSServer } from 'ws';
import type { Logger } from '../utils/Logger.js';
import type { MessageRouter } from './MessageRouter.js';

/**
 * WebSocket server
 * Handles WebSocket connections and message routing
 */
export class WebSocketServer {
  private wss: WSServer | null = null;
  private clients = new Map<string, WebSocket>();
  private logger: Logger;

  constructor(
    private messageRouter: MessageRouter,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'WebSocketServer' });
  }

  /**
   * Start the WebSocket server attached to HTTP server
   */
  start(httpServer: HttpServer): void {
    this.logger.info('Starting WebSocket server');

    this.wss = new WSServer({
      server: httpServer,
      path: '/ws',
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.logger.info('WebSocket server started');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, ws);

    this.logger.info('Client connected', { clientId, total: this.clients.size });

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

    // Set up ping/pong for connection health
    this.setupHeartbeat(clientId, ws);
  }

  /**
   * Handle incoming message from client
   */
  private async handleMessage(clientId: string, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString()) as IWebSocketMessage;

      this.logger.debug('Received message', {
        clientId,
        type: message.type,
        id: message.id,
      });

      // Handle ping
      if (message.type === MessageType.PING) {
        const pong = createPongMessage(message.id);
        this.sendToClient(clientId, pong);
        return;
      }

      // Route message to appropriate handler
      const response = await this.messageRouter.route(message, clientId);

      // Send response if provided
      if (response) {
        this.sendToClient(clientId, response);
      }
    } catch (error) {
      this.logger.error('Failed to handle message', error, { clientId });

      // Send error response
      this.sendToClient(
        clientId,
        createErrorMessage(
          'MESSAGE_HANDLING_ERROR',
          error instanceof Error ? error.message : 'Unknown error'
        )
      );
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string): void {
    this.clients.delete(clientId);
    this.logger.info('Client disconnected', { clientId, total: this.clients.size });
  }

  /**
   * Set up heartbeat (ping/pong) for connection health
   */
  private setupHeartbeat(clientId: string, ws: WebSocket): void {
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(interval);
      }
    }, 30000); // Ping every 30 seconds

    ws.on('pong', () => {
      this.logger.debug('Received pong', { clientId });
    });

    ws.on('close', () => {
      clearInterval(interval);
    });
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
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping WebSocket server');

    // Close all client connections
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss?.close(() => resolve());
      });
      this.wss = null;
    }

    this.logger.info('WebSocket server stopped');
  }
}
