import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../utils/Logger.js';
import {
  DiscordIntegration,
  type DiscordMessage,
  DiscordMessageDeletedError,
} from './DiscordIntegration.js';

const CHANNEL = '123456789012345678';
const CONFIG = { botToken: 'secret-token', notificationChannelId: CHANNEL };

const message: DiscordMessage = { content: 'Hey @everyone', embeds: [], pingEveryone: true };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DiscordIntegration', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let discord: DiscordIntegration;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async () => json(200, { id: CHANNEL }));
    vi.stubGlobal('fetch', fetchMock);
    discord = new DiscordIntegration(new Logger({ level: 'silent' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const requestAt = (index: number) => {
    const [url, init] = fetchMock.mock.calls[index] ?? [];
    return { url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined };
  };

  it('refuses a channel id that is not a Discord id', () => {
    expect(() => discord.initialize({ botToken: 'x', notificationChannelId: '#notifs' })).toThrow(
      /notificationChannelId/
    );
  });

  it('reports an error rather than starting without a config', async () => {
    await discord.start();

    expect(discord.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('connects once it can see the notification channel', async () => {
    await discord.initialize(CONFIG);
    await discord.start();

    expect(discord.getStatus()).toBe(IntegrationStatus.CONNECTED);
    const { url, init } = requestAt(0);
    expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bot secret-token');
    expect(discord.getNotificationChannelId()).toBe(CHANNEL);
  });

  it('reports a rejected token as an error', async () => {
    fetchMock.mockResolvedValue(json(401, { message: '401: Unauthorized' }));
    await discord.initialize(CONFIG);
    await discord.start();

    expect(discord.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(discord.getErrorMessage()).toMatch(/bot token/);
  });

  it('recovers from an unreachable Discord on the next request that succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await discord.initialize(CONFIG);
    await discord.start();
    expect(discord.getStatus()).toBe(IntegrationStatus.ERROR);

    fetchMock.mockResolvedValue(json(200, { id: '900000000000000001' }));
    await discord.postMessage(CHANNEL, message);

    expect(discord.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('lets a post ping everyone and nobody else', async () => {
    await discord.initialize(CONFIG);
    await discord.start();
    fetchMock.mockResolvedValue(json(200, { id: '900000000000000001' }));

    await expect(discord.postMessage(CHANNEL, message)).resolves.toBe('900000000000000001');

    const { url, init, body } = requestAt(1);
    expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages`);
    expect(init?.method).toBe('POST');
    expect(body).toEqual({
      content: 'Hey @everyone',
      embeds: [],
      allowed_mentions: { parse: ['everyone'] },
    });
  });

  it('never pings when editing', async () => {
    await discord.initialize(CONFIG);
    await discord.start();

    await discord.editMessage(CHANNEL, '900000000000000001', message);

    const { url, init, body } = requestAt(1);
    expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages/900000000000000001`);
    expect(init?.method).toBe('PATCH');
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('waits out a short rate limit and tries once more', async () => {
    vi.useFakeTimers();
    await discord.initialize(CONFIG);
    fetchMock
      .mockResolvedValueOnce(json(200, { id: CHANNEL }))
      .mockResolvedValueOnce(json(429, { retry_after: 1.5 }))
      .mockResolvedValueOnce(json(200, { id: '900000000000000001' }));
    await discord.start();

    const posted = discord.postMessage(CHANNEL, message);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(posted).resolves.toBe('900000000000000001');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a deleted message as deleted, without blaming the channel', async () => {
    await discord.initialize(CONFIG);
    await discord.start();
    fetchMock.mockResolvedValue(json(404, { code: 10008, message: 'Unknown Message' }));

    await expect(
      discord.editMessage(CHANNEL, '900000000000000001', message)
    ).rejects.toBeInstanceOf(DiscordMessageDeletedError);
    expect(discord.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('reports an unreadable rate limit rather than failing silently', async () => {
    await discord.initialize(CONFIG);
    await discord.start();
    fetchMock.mockResolvedValue(new Response('<html>banned</html>', { status: 429 }));

    await expect(discord.postMessage(CHANNEL, message)).rejects.toThrow(/rate limiting/);
    expect(discord.getStatus()).toBe(IntegrationStatus.ERROR);
  });

  it('reports a long rate limit as an error, without waiting it out', async () => {
    await discord.initialize(CONFIG);
    await discord.start();
    fetchMock.mockResolvedValue(json(429, { retry_after: 60 }));

    await expect(discord.postMessage(CHANNEL, message)).rejects.toThrow(/retry in 60s/);
    expect(discord.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('leaves the status alone when a request finishes after Discord was stopped', async () => {
    await discord.initialize(CONFIG);
    await discord.start();
    let respond: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      })
    );

    const posted = discord.postMessage(CHANNEL, message);
    await discord.stop();
    respond(json(200, { id: '900000000000000001' }));

    await expect(posted).rejects.toThrow(/stopped/);
    expect(discord.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('refuses to send anything once stopped', async () => {
    await discord.initialize(CONFIG);
    await discord.start();
    await discord.stop();

    await expect(discord.postMessage(CHANNEL, message)).rejects.toThrow(/not running/);
    expect(discord.getNotificationChannelId()).toBeNull();
  });
});
