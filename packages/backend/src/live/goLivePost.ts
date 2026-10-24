import { platformDisplayName, StreamingPlatform } from '@turingmod/shared';
import { z } from 'zod';
import type {
  DiscordEmbed,
  DiscordMessage,
} from '../integrations/implementations/discord/DiscordIntegration.js';

/** What a go-live post says about the stream. */
export const StreamSummarySchema = z.strictObject({
  /** The streamer's name, from the first platform that went live. */
  channelName: z.string().min(1),
  title: z.string().nullable(),
  game: z.string().nullable(),
  /** Where to watch, for every platform that has been live during this stream. */
  links: z.array(z.strictObject({ platform: z.enum(StreamingPlatform), url: z.url() })),
  /** As the platform gives it; the post adds `previewStamp` to it. */
  previewImageUrl: z.url().nullable(),
  /** Epoch ms. */
  startedAt: z.number().int(),
});

export type StreamSummary = z.infer<typeof StreamSummarySchema>;

/** The post of the stream in progress, as stored by `GoLivePostRepository`. */
export const GoLivePostSchema = z.strictObject({
  channelId: z.string().min(1),
  /** Null once someone has deleted the post: it isn't edited, or posted again, this stream. */
  messageId: z.string().min(1).nullable(),
  /**
   * Epoch ms when some platform was last known to be live: kept current while live, so after a
   * crash it says roughly when the stream was last seen. The stream counts as over once no
   * platform has been live for the grace period after this.
   */
  lastLiveAt: z.number().int(),
  /**
   * Epoch ms, added to the preview image's URL. Discord caches an image by its URL, so changing
   * this is what makes it fetch a new frame.
   */
  previewStamp: z.number().int(),
  stream: StreamSummarySchema,
});

export type GoLivePost = z.infer<typeof GoLivePostSchema>;

const LIVE_COLOR = 0x9146ff;
const ENDED_COLOR = 0x71717a;

/** Discord's limit on an embed title. */
const MAX_EMBED_TITLE = 256;

/**
 * The post announcing a stream, linking the platforms in `live`. The one message that pings:
 * `@everyone`, and nothing a platform supplied (a title can't mention anyone).
 */
export function renderLivePost(
  stream: StreamSummary,
  live: StreamingPlatform[],
  previewStamp: number
): DiscordMessage {
  const links = stream.links.filter((link) => live.includes(link.platform));
  const content = [
    `Hey @everyone, ${escapeMarkdown(stream.channelName)} is live! Come join:`,
    ...links.map(linkLine),
  ].join('\n');

  const embed: DiscordEmbed = {
    ...describeStream(stream, links[0]?.url),
    color: LIVE_COLOR,
    footer: {
      text: `Live on ${links.map((link) => platformDisplayName(link.platform)).join(' · ')}`,
    },
    timestamp: new Date(stream.startedAt).toISOString(),
  };
  if (stream.previewImageUrl) {
    embed.image = { url: `${stream.previewImageUrl}?t=${previewStamp}` };
  }
  return { content, embeds: [embed], pingEveryone: true };
}

/** The same post once the stream is over: how long it ran, and where it was. */
export function renderEndedPost(stream: StreamSummary, endedAt: number): DiscordMessage {
  const content = [
    `${escapeMarkdown(stream.channelName)} was live for ${formatDuration(endedAt - stream.startedAt)}.`,
    ...stream.links.map(linkLine),
  ].join('\n');

  const embed: DiscordEmbed = {
    ...describeStream(stream, stream.links[0]?.url),
    color: ENDED_COLOR,
    footer: { text: 'Stream ended' },
    timestamp: new Date(endedAt).toISOString(),
  };
  return { content, embeds: [embed], pingEveryone: false };
}

/** e.g. `3h 12m`, or `45m` under an hour. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function describeStream(stream: StreamSummary, url: string | undefined): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: truncate(stream.title || `${stream.channelName}'s stream`, MAX_EMBED_TITLE),
  };
  if (url) {
    embed.url = url;
  }
  if (stream.game) {
    embed.description = `Playing **${escapeMarkdown(stream.game)}**`;
  }
  return embed;
}

/** `<url>` stops Discord adding a preview of its own for each link beneath the post. */
function linkLine({ platform, url }: { platform: StreamingPlatform; url: string }): string {
  return `• ${platformDisplayName(platform)}: <${url}>`;
}

/** Mid-line, only these change how text renders. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|]/g, '\\$&');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
