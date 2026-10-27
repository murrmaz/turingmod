import {
  type DiscordConfig,
  DiscordConfigSchema,
  DiscordSnowflakeSchema,
  IntegrationName,
  IntegrationStatus,
  messageOf,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';

const DISCORD_API = 'https://discord.com/api/v10';
/** Discord asks bots to identify themselves in this form. */
const USER_AGENT = 'DiscordBot (https://github.com/murrmaz/turingmod, 1.0)';
/** The longest rate-limit wait worth sitting out; anything longer fails the request instead. */
const MAX_RATE_LIMIT_WAIT_MS = 10_000;

/** The parts of a Discord embed TuringMod uses. */
export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  /** 0xRRGGBB. */
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url: string };
  footer?: { text: string };
  /** ISO 8601. */
  timestamp?: string;
}

/** A message to post or the new contents of one being edited. */
export interface DiscordMessage {
  content: string;
  embeds: DiscordEmbed[];
  /**
   * Whether an `@everyone` in `content` pings. Nothing else in a message ever pings, so a stream
   * title can't mention anyone. Editing a message never pings, whatever this says.
   */
  pingEveryone: boolean;
}

const CreatedMessageSchema = z.object({ id: DiscordSnowflakeSchema });
const RateLimitSchema = z.object({ retry_after: z.number() });
/** The JSON body Discord sends with most errors. */
const ErrorBodySchema = z.object({ code: z.number(), message: z.string() });

/** Discord's error code for a message that doesn't exist (any more). */
const UNKNOWN_MESSAGE = 10008;

/** A request Discord answered with an error status. */
export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

/**
 * The message being edited no longer exists: someone deleted it. Nothing is wrong with the bot or
 * the channel, so it doesn't change Discord's status.
 */
export class DiscordMessageDeletedError extends Error {
  constructor(path: string) {
    super(`The Discord message was deleted (${path})`);
    this.name = 'DiscordMessageDeletedError';
  }
}

/**
 * Discord, through a bot's token over its REST API. Posts and edits messages; it has no
 * connection to Discord's gateway, so it can't receive anything.
 *
 * Its status is what the last request found: a request that succeeds after an outage reports it
 * connected again, and one that fails reports the error. So a Discord outage at startup doesn't
 * need a restart, the next post retries. A request still in flight when Discord is stopped (or
 * restarted) is abandoned without touching the status.
 */
@singleton()
export class DiscordIntegration extends BaseIntegration {
  readonly name = IntegrationName.DISCORD;

  private config: DiscordConfig | null = null;
  private started = false;
  /** Bumped by `start()` and `stop()`, so a request that outlives either reports nothing. */
  private generation = 0;

  constructor(logger: Logger) {
    super(logger, { component: 'DiscordIntegration' });
  }

  override initialize(stored: unknown): Promise<void> {
    this.config = this.parseConfig(DiscordConfigSchema, stored);
    return Promise.resolve();
  }

  /** Check that the token works and the bot can see the notification channel. */
  async start(): Promise<void> {
    this.generation++;
    if (!this.config) {
      this.reportError('Not set up yet: enter the bot token and channel in Set up');
      return;
    }
    const { notificationChannelId } = this.config;
    this.started = true;
    this.setStatus(IntegrationStatus.CONNECTING);
    try {
      await this.request('GET', `/channels/${notificationChannelId}`);
    } catch (error) {
      // request() has reported it as ERROR; failing start() too would only log it twice.
      this.logger.warn('Could not reach the Discord channel', { error });
    }
  }

  stop(): Promise<void> {
    this.generation++;
    this.started = false;
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }

  /** The channel go-live notifications go to, or null until Discord is set up and started. */
  getNotificationChannelId(): string | null {
    return this.started ? (this.config?.notificationChannelId ?? null) : null;
  }

  /** Post a message, returning its id. */
  async postMessage(channelId: string, message: DiscordMessage): Promise<string> {
    const created = await this.request(
      'POST',
      `/channels/${channelId}/messages`,
      toRequestBody(message)
    );
    return CreatedMessageSchema.parse(created).id;
  }

  /**
   * Replace a message's content and embeds. Rejects with `DiscordMessageDeletedError` if the
   * message has been deleted.
   */
  async editMessage(channelId: string, messageId: string, message: DiscordMessage): Promise<void> {
    await this.request(
      'PATCH',
      `/channels/${channelId}/messages/${messageId}`,
      toRequestBody({ ...message, pingEveryone: false })
    );
  }

  /**
   * One REST call, returning the parsed response body. Sits out one short rate limit; reports a
   * failure as ERROR (unless Discord only refused the request's contents, or the message was
   * deleted), and any success as CONNECTED.
   */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!(this.started && this.config)) {
      throw new Error('Discord is not running');
    }
    const token = this.config.botToken;
    const generation = this.generation;
    /** Throws if Discord was stopped or restarted since the request began. */
    const stillCurrent = () => {
      if (this.generation !== generation) {
        throw new Error('Discord was stopped during the request');
      }
    };

    const send = async (): Promise<Response> => {
      let response: Response;
      try {
        response = await fetch(`${DISCORD_API}${path}`, {
          method,
          headers: {
            authorization: `Bot ${token}`,
            'User-Agent': USER_AGENT,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        stillCurrent();
        this.reportError(`Can't reach Discord (${messageOf(error)}); the next post tries again`);
        throw error;
      }
      stillCurrent();
      return response;
    };

    let response = await send();
    if (response.status === 429) {
      const waitMs = await retryAfterMs(response);
      stillCurrent();
      if (waitMs === null || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
        const message =
          waitMs === null
            ? 'Discord is rate limiting TuringMod'
            : `Discord is rate limiting TuringMod: retry in ${Math.ceil(waitMs / 1000)}s`;
        this.reportError(message);
        throw new DiscordApiError(429, message);
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      stillCurrent();
      response = await send();
    }

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      stillCurrent();
      if (response.status === 404 && errorBody?.code === UNKNOWN_MESSAGE) {
        throw new DiscordMessageDeletedError(path);
      }
      const error = new DiscordApiError(
        response.status,
        describeFailure(response.status, errorBody, path)
      );
      if (response.status === 400) {
        // Discord refused what we sent, which says nothing about the connection.
        this.reportFailure(error);
      } else {
        this.reportError(error.message);
      }
      throw error;
    }

    if (this.status !== IntegrationStatus.CONNECTED) {
      this.setStatus(IntegrationStatus.CONNECTED);
    }
    return response.status === 204 ? null : response.json();
  }
}

function toRequestBody({ content, embeds, pingEveryone }: DiscordMessage) {
  return {
    content,
    embeds,
    allowed_mentions: { parse: pingEveryone ? ['everyone'] : [] },
  };
}

/** How long a 429 asks us to wait, or null if its body doesn't say. */
async function retryAfterMs(response: Response): Promise<number | null> {
  const parsed = RateLimitSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? Math.ceil(parsed.data.retry_after * 1000) : null;
}

async function readErrorBody(response: Response): Promise<z.infer<typeof ErrorBodySchema> | null> {
  const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** What a failed request means, in terms the streamer can act on. */
function describeFailure(
  status: number,
  errorBody: z.infer<typeof ErrorBodySchema> | null,
  path: string
): string {
  switch (status) {
    case 401:
      return 'Discord rejected the bot token: copy a new one from the Bot page and set it up again';
    case 403:
      return `The bot isn't allowed to do that in the channel: give it View Channel, Send Messages, Embed Links and Mention Everyone there (${path})`;
    case 404:
      return `Discord can't find that channel: check the channel id, and that the bot has been invited to the server (${path})`;
    default:
      return `Discord answered ${status}${errorBody ? `: ${errorBody.message}` : ''}`;
  }
}
