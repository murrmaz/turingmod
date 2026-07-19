import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import type { EventBus } from '../core/EventBus.js';
import type { IntegrationManager } from '../integrations/IntegrationManager.js';
import type { Logger } from '../utils/Logger.js';

/**
 * HTTP server
 * Serves static files and handles health checks
 * WebSocket server attaches to this
 */
export class HttpServer {
  private server: Server | null = null;
  private logger: Logger;

  /** OAuth callback path -> integration name, from IntegrationManager.getOAuthCallbackRoutes() */
  private oauthCallbackRoutes = new Map<string, string>();

  constructor(
    private port: number,
    private host: string,
    private frontendDistPath: string,
    private eventBus: EventBus,
    private integrationManager: IntegrationManager,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'HttpServer' });
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    this.logger.info('Starting HTTP server', {
      host: this.host,
      port: this.port,
      frontendPath: this.frontendDistPath,
    });

    this.buildOAuthCallbackRoutes();

    this.server = createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.port, this.host, () => {
        this.logger.info(`HTTP server listening on http://${this.host}:${this.port}`);
        resolve();
      });

      this.server?.on('error', (error) => {
        this.logger.error('HTTP server error', error);
        reject(error);
      });
    });
  }

  /**
   * Build the OAuth callback routing table. IntegrationManager owns the
   * integration instances and derives the routing data itself — HttpServer
   * only ever sees the resulting path -> integration name pairs.
   */
  private buildOAuthCallbackRoutes(): void {
    this.oauthCallbackRoutes.clear();

    for (const { path, integrationName } of this.integrationManager.getOAuthCallbackRoutes()) {
      this.oauthCallbackRoutes.set(path, integrationName);
    }
  }

  /**
   * Handle HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';
    const pathname = url.split('?')[0] || '/';

    this.logger.debug(`HTTP ${req.method} ${url}`);

    // Health check endpoint
    if (url === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // OAuth callback endpoints (per-provider, from the routing table)
    const oauthIntegrationName = this.oauthCallbackRoutes.get(pathname);
    if (oauthIntegrationName) {
      this.handleOAuthCallback(oauthIntegrationName, url, res);
      return;
    }

    // Serve static files in production
    if (existsSync(this.frontendDistPath)) {
      await this.serveStaticFile(url, res);
    } else {
      // Development mode - no static files
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Frontend not built. Run: npm run build:frontend');
    }
  }

  /**
   * Handle OAuth callback for any integration
   */
  private handleOAuthCallback(integrationName: string, url: string, res: ServerResponse): void {
    try {
      // Parse query parameters
      const urlObj = new URL(url, `http://localhost:${this.port}`);
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      const error = urlObj.searchParams.get('error');
      const errorDescription = urlObj.searchParams.get('error_description');

      if (error) {
        this.logger.error('OAuth callback error', error, { integrationName, errorDescription });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Authorization Failed</title>
            </head>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Authorization Failed</h1>
              <p>Error: ${error}</p>
              <p>${errorDescription || ''}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code');
        return;
      }

      // Resolve `state` back to the WebSocket client that started this flow.
      // Rejects missing/expired/reused/mismatched state so the code can
      // never be routed (or attributed) to the wrong client.
      const clientId = this.integrationManager.consumeOAuthState(integrationName, state);
      if (!clientId) {
        this.logger.warn('OAuth callback rejected: invalid or expired state', {
          integrationName,
        });
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Authorization Failed</title>
            </head>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Authorization Failed</h1>
              <p>This authorization request is invalid or has expired.</p>
              <p>Please close this window and try connecting again from TuringMod.</p>
            </body>
          </html>
        `);
        return;
      }

      this.logger.info('OAuth callback received with code', { integrationName });

      // Emit event with the code for the client that started this flow
      this.eventBus.emit('oauth:callback', {
        integrationName,
        code,
        clientId,
      });

      // Return success page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Authorization Successful</title>
          </head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>Authorization Successful</h1>
            <p>You can close this window and return to TuringMod.</p>
          </body>
        </html>
      `);
    } catch (error) {
      this.logger.error('Error handling OAuth callback', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  }

  /**
   * Serve static file from frontend dist
   */
  private async serveStaticFile(url: string, res: ServerResponse): Promise<void> {
    try {
      // Clean URL and remove query params
      let filePath = url.split('?')[0] || '/';

      // Default to index.html for root and directories
      if (filePath === '/' || filePath.endsWith('/')) {
        filePath = '/index.html';
      }

      // Construct full file path
      const fullPath = join(this.frontendDistPath, filePath);

      // Security check: ensure path is within frontend dist
      if (!fullPath.startsWith(this.frontendDistPath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      // Check if file exists
      if (!existsSync(fullPath)) {
        // SPA fallback: serve index.html for client-side routes
        const indexPath = join(this.frontendDistPath, 'index.html');
        if (existsSync(indexPath)) {
          const content = await readFile(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // Check if it's a file (not a directory)
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        // Serve index.html from directory
        const indexPath = join(fullPath, 'index.html');
        if (existsSync(indexPath)) {
          const content = await readFile(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // Read and serve file
      const content = await readFile(fullPath);
      const contentType = this.getContentType(filePath);

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      this.logger.error('Error serving static file', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
    };

    return contentTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get the underlying Node.js HTTP server
   */
  getServer(): Server {
    if (!this.server) {
      throw new Error('HTTP server not started');
    }
    return this.server;
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping HTTP server');

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    this.logger.info('HTTP server stopped');
  }
}
