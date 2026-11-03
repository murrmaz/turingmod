import { platformDisplayName, StreamingPlatform } from '@turingmod/shared';
import type { StreamSummary } from '../../database/repositories/GoLivePostRepository.js';
import type {
  DiscordEmbed,
  DiscordMessage,
} from '../../integrations/implementations/discord/DiscordIntegration.js';
import { formatDuration } from '../../utils/FormatHelpers.js';

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
