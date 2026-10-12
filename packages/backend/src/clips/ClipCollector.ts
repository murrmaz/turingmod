import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { ChatMessageEvent } from '../platforms/chatMessage.js';
import type { ClipInfo } from '../platforms/interfaces/IStreamPlatform.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import { DATA_DIRECTORY } from '../utils/paths.js';

/** Twitch clip links, in both the clips.twitch.tv and twitch.tv/<channel>/clip forms. */
const CLIP_LINK =
  /(?:https?:\/\/)?(?:clips\.twitch\.tv\/(?:embed\?clip=)?|(?:www\.|m\.)?twitch\.tv\/\w+\/clip\/)([\w-]+)/gi;

/** Clip ids linked in a chat message. */
export function clipIdsIn(message: string): string[] {
  return [...message.matchAll(CLIP_LINK)].flatMap((match) => (match[1] ? [match[1]] : []));
}

/**
 * Collects the Twitch clips chat links while collection is on, and writes them to an HTML page
 * for the streamer when it's turned off. Each link is checked with Twitch, so only real clips
 * are kept, once each, in the order they were first linked.
 */
@injectable()
@singleton()
export class ClipCollector {
  private collecting: Map<string, ClipInfo> | null = null;
  private subscribed = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private streamControl: StreamControlService,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ClipCollector' });
  }

  /** Listen to chat. Collection itself starts with `begin()`. */
  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.eventBus.on('chat.message', (event) => this.collectFrom(event));
  }

  isCollecting(): boolean {
    return this.collecting !== null;
  }

  /** Start collecting. Resolves false if collection was already on. */
  begin(): boolean {
    if (this.collecting) return false;
    this.collecting = new Map();
    this.logger.info('Clip collection started');
    return true;
  }

  /**
   * Stop collecting and write what was collected to an HTML page in the data directory. Resolves
   * to the page's path and the number of clips, or null if collection wasn't on.
   */
  async end(now = new Date()): Promise<{ path: string; count: number } | null> {
    const clips = this.collecting;
    if (!clips) return null;
    this.collecting = null;

    const directory = join(DATA_DIRECTORY, 'clips');
    await mkdir(directory, { recursive: true });
    const path = join(directory, `clips-${now.toISOString().replace(/[:.]/g, '-')}.html`);
    await writeFile(path, renderClipPage([...clips.values()], now));
    this.logger.info(`Clip collection ended: ${clips.size} clip(s) written to ${path}`);
    return { path, count: clips.size };
  }

  /** Look up and keep every new clip a message links. Never rejects. */
  async collectFrom(event: ChatMessageEvent): Promise<void> {
    const clips = this.collecting;
    if (!clips || event.platform !== StreamingPlatform.TWITCH) return;

    for (const id of clipIdsIn(event.message)) {
      if (clips.has(id)) continue;
      try {
        const clip = await this.streamControl.getClip(StreamingPlatform.TWITCH, id);
        // Collection may have ended while the lookup was in flight.
        if (clip && this.collecting === clips) clips.set(id, clip);
      } catch (error) {
        this.logger.warn(`Could not look up clip ${id}`, error);
      }
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** A standalone page listing clips, newest last. */
export function renderClipPage(clips: ClipInfo[], collectedAt: Date): string {
  const items = clips
    .map(
      (clip) =>
        `    <li><a href="${escapeHtml(clip.url)}">${escapeHtml(clip.title)}</a>` +
        ` — clipped by ${escapeHtml(clip.creatorName)}, ${clip.views} view(s)</li>`
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Clips from chat — ${collectedAt.toLocaleDateString()}</title>
</head>
<body>
  <h1>Clips from chat — ${collectedAt.toLocaleDateString()}</h1>
  ${clips.length === 0 ? '<p>No clips were linked.</p>' : `<ol>\n${items}\n  </ol>`}
</body>
</html>
`;
}
