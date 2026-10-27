import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OAuthCallbackOutcome, OAuthFlowService } from '../integrations/OAuthFlowService.js';
import { Logger } from '../utils/Logger.js';
import { escapeHtml, HttpServer, rejectUpgrade } from './HttpServer.js';

const logger = new Logger({ level: 'silent' });

describe('escapeHtml', () => {
  it('escapes the characters that can open a tag or an attribute', () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
    );
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('access_denied: The user denied the request')).toBe(
      'access_denied: The user denied the request'
    );
  });
});

describe('HttpServer OAuth callback', () => {
  let server: HttpServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  /** A server whose OAuth flow completes every callback with `outcome`. */
  async function startServer(outcome: OAuthCallbackOutcome): Promise<string> {
    const oauthFlow = {
      getCallbackRoutes: () => [{ path: '/callback/spotify', integrationName: 'spotify-auth' }],
      handleCallback: () => Promise.resolve(outcome),
    } as unknown as OAuthFlowService;
    server = new HttpServer(0, '127.0.0.1', '/nonexistent', oauthFlow, logger);
    await server.start();
    const { port } = server.getServer().address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async function page(outcome: OAuthCallbackOutcome) {
    const base = await startServer(outcome);
    const response = await fetch(`${base}/callback/spotify?code=c&state=s`);
    return { status: response.status, body: await response.text() };
  }

  it('reports success and leads back to the console that asked', async () => {
    const { status, body } = await page({
      result: 'connected',
      consoleOrigin: 'http://localhost:3000',
    });

    expect(status).toBe(200);
    expect(body).toContain('Authorization successful');
    expect(body).toContain('href="http://localhost:3000/integrations?selected=spotify-auth"');
    expect(body).toContain('window.close()');
    expect(body).toContain(
      'location.replace("http://localhost:3000/integrations?selected=spotify-auth")'
    );
  });

  it("shows a failure's message without letting it inject markup, and doesn't leave by itself", async () => {
    const payload = '<script>new WebSocket("ws://127.0.0.1/trpc")</script>';
    const { body } = await page({
      result: 'failed',
      message: `access_denied: ${payload} <img src=x onerror=1>`,
      consoleOrigin: 'http://localhost:3000',
    });

    expect(body).toContain('Authorization failed');
    expect(body).toContain(escapeHtml(payload));
    expect(body).toContain('&lt;img src=x onerror=1&gt;');
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('<img');
    expect(body).toContain('Back to TuringMod');
  });

  it('refuses an invalid or expired state', async () => {
    const { status, body } = await page({ result: 'invalid' });

    expect(status).toBe(400);
    expect(body).toContain('invalid or has expired');
  });

  it('says to return to TuringMod when it does not know where the console is', async () => {
    const { body } = await page({ result: 'connected', consoleOrigin: null });

    expect(body).toContain('return to TuringMod');
    expect(body).not.toContain('<script>');
  });
});

describe('HttpServer static files', () => {
  let root: string;
  let server: HttpServer;
  let port: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'turingmod-static-test-'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'index.html'), '<p>console</p>');
    await writeFile(join(root, 'dist', 'app.js'), 'console.log(1);');
    await mkdir(join(root, 'dist-old'));
    await writeFile(join(root, 'dist-old', 'secret.txt'), 'secret');
    await writeFile(join(root, 'secret.txt'), 'secret');

    const oauthFlow = { getCallbackRoutes: () => [] } as unknown as OAuthFlowService;
    server = new HttpServer(0, '127.0.0.1', join(root, 'dist'), oauthFlow, logger);
    await server.start();
    ({ port } = server.getServer().address() as AddressInfo);
  });

  afterEach(async () => {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  });

  /** Send `path` exactly as written: fetch() would resolve `..` before sending it. */
  function get(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
        .on('error', reject)
        .end();
    });
  }

  it('serves files from the build', async () => {
    expect(await get('/app.js')).toEqual({ status: 200, body: 'console.log(1);' });
    expect(await get('/')).toEqual({ status: 200, body: '<p>console</p>' });
  });

  it('refuses a path into a sibling folder whose name starts with the same characters', async () => {
    expect((await get('/../dist-old/secret.txt')).status).toBe(403);
  });

  it('refuses a path out of the build', async () => {
    expect((await get('/../secret.txt')).status).toBe(403);
  });
});

describe('rejectUpgrade', () => {
  it('answers with the status and survives the client resetting the connection', () => {
    const socket = new PassThrough();
    const written: string[] = [];
    socket.on('data', (chunk: Buffer) => written.push(chunk.toString()));

    rejectUpgrade(socket, 404, 'Not Found');

    expect(written.join('')).toContain('HTTP/1.1 404 Not Found');
    expect(() => socket.emit('error', new Error('read ECONNRESET'))).not.toThrow();
  });
});
