import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { OAuthFlowService } from '../integrations/OAuthFlowService.js';
import { Logger } from '../utils/Logger.js';
import { escapeHtml, HttpServer } from './HttpServer.js';

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

  async function startServer(): Promise<string> {
    const oauthFlow = {
      getCallbackRoutes: () => [{ path: '/callback/spotify', integrationName: 'spotify-auth' }],
    } as unknown as OAuthFlowService;
    server = new HttpServer(
      0,
      '127.0.0.1',
      '/nonexistent',
      new EventBus(logger),
      oauthFlow,
      logger
    );
    await server.start();
    const { port } = server.getServer().address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("shows the provider's error without letting it inject markup", async () => {
    const base = await startServer();
    const payload = '<script>new WebSocket("ws://127.0.0.1/ws")</script>';
    const query = new URLSearchParams({
      error: payload,
      error_description: `<img src=x onerror=1>`,
    });

    const response = await fetch(`${base}/callback/spotify?${query}`);
    const body = await response.text();

    expect(body).toContain('Authorization Failed');
    expect(body).toContain(escapeHtml(payload));
    expect(body).toContain('&lt;img src=x onerror=1&gt;');
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('<img');
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
    server = new HttpServer(
      0,
      '127.0.0.1',
      join(root, 'dist'),
      new EventBus(logger),
      oauthFlow,
      logger
    );
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
