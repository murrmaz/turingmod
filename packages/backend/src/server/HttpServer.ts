import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import type { OAuthFlowService } from '../integrations/OAuthFlowService.js';
import type { Logger } from '../utils/Logger.js';
import { rejectUpgrade } from './consoleSockets.js';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Make text safe to place in HTML. The OAuth callback page shows the provider's error, which comes
 * from the URL and so from whoever made the link: a page served from this origin is trusted by the
 * WebSocket's origin check, so script injected into it could drive the whole console.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

interface CallbackPage {
  title: string;
  /** Plain text, escaped here: an error can come from the provider's redirect URL. */
  lines: string[];
  /** The console page to go back to, or null when it isn't known. */
  returnUrl?: string | null;
  /**
   * Leave by itself: a popup the console opened closes (the console already knows), and a tab
   * whose console was closed meanwhile goes back to it.
   */
  returnAutomatically?: boolean;
}

/** Render a page for the end of an OAuth callback. */
function sendPage(res: ServerResponse, status: number, page: CallbackPage): void {
  const { title, lines, returnUrl = null, returnAutomatically = false } = page;
  const back =
    returnUrl === null
      ? '<p>You can close this window and return to TuringMod.</p>'
      : `<p><a href="${escapeHtml(returnUrl)}">Back to TuringMod</a></p>`;
  // JSON is a valid script literal; escaping `<` keeps a `</script>` from ending the block.
  const script =
    returnAutomatically && returnUrl !== null
      ? `<script>
        if (window.opener) {
          window.close();
        } else {
          setTimeout(() => location.replace(${JSON.stringify(returnUrl).replace(/</g, '\\u003c')}), 1500);
        }
      </script>`
      : '';
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
      </head>
      <body style="font-family: system-ui; padding: 40px; text-align: center;">
        <h1>${escapeHtml(title)}</h1>
        ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n        ')}
        ${back}
        ${script}
      </body>
    </html>`);
}

/** A WebSocket endpoint, given the upgrade requests for its path. */
export interface UpgradeHandler {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

/**
 * HTTP server
 * Serves static files and handles health checks, and hands WebSocket upgrades to the endpoint
 * registered for their path. The `ws` library can't share one server between two endpoints by
 * itself: each would reject the other's upgrades.
 */
export class HttpServer {
  private server: Server | null = null;
  private logger: Logger;

  /** OAuth callback path -> integration name, from OAuthFlowService.getCallbackRoutes() */
  private oauthCallbackRoutes = new Map<string, string>();

  /** WebSocket path -> the endpoint that accepts upgrades on it */
  private upgradeRoutes = new Map<string, UpgradeHandler>();

  constructor(
    private port: number,
    private host: string,
    private frontendDistPath: string,
    private oauthFlow: OAuthFlowService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'HttpServer' });
  }

  /** Hand WebSocket upgrades on `path` to `handler`. */
  routeUpgrades(path: string, handler: UpgradeHandler): void {
    if (this.upgradeRoutes.has(path)) {
      throw new Error(`WebSocket path already routed: ${path}`);
    }
    this.upgradeRoutes.set(path, handler);
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    this.logger.debug('Starting HTTP server', {
      host: this.host,
      port: this.port,
      frontendPath: this.frontendDistPath,
    });

    this.buildOAuthCallbackRoutes();

    this.server = createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = (req.url ?? '/').split('?')[0] ?? '/';
      const handler = this.upgradeRoutes.get(pathname);
      if (handler) {
        handler.handleUpgrade(req, socket, head);
        return;
      }
      this.logger.warn('Rejected WebSocket upgrade: no endpoint at path', { pathname });
      rejectUpgrade(socket, 404, 'Not Found');
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.port, this.host, () => {
        this.logger.info('*********************************************************');
        this.logger.info(`HTTP server listening on http://${this.host}:${this.port}`);
        this.logger.info('*********************************************************');
        resolve();
      });

      this.server?.on('error', (error) => {
        this.logger.error('HTTP server error', error);
        reject(error);
      });
    });
  }

  /**
   * Build the OAuth callback routing table. OAuthFlowService derives the
   * routing data from the integrations itself — HttpServer
   * only ever sees the resulting path -> integration name pairs.
   */
  private buildOAuthCallbackRoutes(): void {
    this.oauthCallbackRoutes.clear();

    for (const { path, integrationName } of this.oauthFlow.getCallbackRoutes()) {
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
      await this.handleOAuthCallback(oauthIntegrationName, url, res);
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
   * The page the provider's redirect lands on. OAuthFlowService completes the authorization
   * first, so the page reports what actually happened, and every open console has already been
   * told; it then takes the streamer back to the console that asked.
   */
  private async handleOAuthCallback(
    integrationName: string,
    url: string,
    res: ServerResponse
  ): Promise<void> {
    try {
      const query = new URL(url, `http://localhost:${this.port}`).searchParams;
      const outcome = await this.oauthFlow.handleCallback(integrationName, {
        code: query.get('code'),
        state: query.get('state'),
        error: query.get('error'),
        errorDescription: query.get('error_description'),
      });

      if (outcome.result === 'invalid') {
        this.logger.warn('OAuth callback rejected: invalid or expired state', { integrationName });
        sendPage(res, 400, {
          title: 'Authorization failed',
          lines: [
            'This authorization request is invalid or has expired.',
            'Please close this window and try connecting again from TuringMod.',
          ],
        });
        return;
      }

      const returnUrl =
        outcome.consoleOrigin === null
          ? null
          : `${outcome.consoleOrigin}/integrations?selected=${encodeURIComponent(integrationName)}`;

      if (outcome.result === 'failed') {
        this.logger.error('OAuth authorization failed', outcome.message, { integrationName });
        sendPage(res, 200, {
          title: 'Authorization failed',
          lines: [outcome.message, 'You can try again from TuringMod.'],
          returnUrl,
        });
        return;
      }

      this.logger.info('OAuth authorization completed', { integrationName });
      sendPage(res, 200, {
        title: 'Authorization successful',
        lines: [`${integrationName} is connected.`],
        returnUrl,
        returnAutomatically: true,
      });
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

      // Refuse anything outside the frontend build. Compared by folder, not by string prefix:
      // a sibling such as `dist-old` starts with the same characters.
      const fromDist = relative(this.frontendDistPath, fullPath);
      if (fromDist === '..' || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
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
