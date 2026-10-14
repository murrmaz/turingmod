import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
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
