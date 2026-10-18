import { IntegrationStatus, messageOf, type StreamingPlatform } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { GoLivePostRepository } from '../database/repositories/GoLivePostRepository.js';
import {
  DiscordIntegration,
  DiscordMessageDeletedError,
} from '../integrations/implementations/discord/DiscordIntegration.js';
import type { ChannelPage, StreamInfo } from '../platforms/interfaces/IStreamPlatform.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { Logger } from '../utils/Logger.js';
import {
  type GoLivePost,
  renderEndedPost,
  renderLivePost,
  type StreamSummary,
} from './goLivePost.js';
import { PlatformLiveStatus } from './PlatformLiveStatus.js';

/**
 * How long every platform must stay offline before the stream counts as over. A crash or a quick
 * restart of the stream comes back within it and carries on in the same post, without a second
 * ping.
 */
export const GO_LIVE_GRACE_MS = 10 * 60_000;
/** How often, while live, to record that the stream is still going, for after a crash. */
const HEARTBEAT_MS = 60_000;
/**
 * When to fetch the preview image again after posting. A platform has no frame of a stream that
 * has only just started, so the first post often shows its offline placeholder.
 */
export const PREVIEW_REFRESH_MS = 3 * 60_000;

/** What one live platform contributes to the post. */
interface PlatformDetails {
  page: ChannelPage;
  info: StreamInfo | null;
}

/**
 * Announces a stream in Discord: one post, with an `@everyone`, when the first platform goes live,
 * however many follow. The post is edited as platforms join and leave and as the title or game
 * changes, and once the stream is over it is rewritten to say how long it ran.
 *
 * The stream is over only on evidence: every platform the post covered has been offline for
 * `GO_LIVE_GRACE_MS`, and each of them is reachable and says it isn't live. A platform that is
 * disconnected (TuringMod just started, or its login lapsed) is unknown rather than offline, so
 * the post waits for it. In the other direction, a platform going live continues the post only if
 * its broadcast started within the grace period of the post's last sign of life; anything later
 * is a new stream, which ends the old post and makes a new one.
 *
 * The post is stored (`GoLivePostRepository`) until then, so TuringMod restarting mid-stream picks
 * it up again rather than pinging everyone twice. Every minute while live it records that the
 * stream was still going: after a crash, that is when the stream was last seen.
 *
 * A post that couldn't be made (Discord not running yet, or down) is tried again when Discord
 * connects and on each heartbeat. A post someone deleted is left deleted for the rest of the
 * stream: posting it again would ping everyone again.
 */
@singleton()
export class GoLiveAnnouncer implements IService {
  private subscriptions = new Subscriptions();
  private logger: Logger;
  /** Serializes the work, so two platforms going live together can't make two posts. */
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private endTimer: NodeJS.Timeout | null = null;
  private previewTimer: NodeJS.Timeout | null = null;
  /** Running while some platform is live; null otherwise. */
  private heartbeat: NodeJS.Timeout | null = null;
  /** Looked up when a platform goes live, and again when its title or game changes. */
  private details = new Map<StreamingPlatform, PlatformDetails>();
  /** What the post was last edited to show, so a change that alters nothing doesn't edit it. */
  private lastShown: string | null = null;

  constructor(
    private eventBus: EventBus,
    private controls: StreamControlService,
    private liveStatus: PlatformLiveStatus,
    private discord: DiscordIntegration,
    private posts: GoLivePostRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'GoLiveAnnouncer' });
  }

  start(): Promise<void> {
    this.stopped = false;
    const sync = () => this.enqueue(() => this.sync());
    this.subscriptions.add(
      this.eventBus.on('platform.liveState', ({ platform, live }) => {
        if (!live) {
          this.details.delete(platform);
        }
        return sync();
      }),
      this.eventBus.on('stream.info.changed', ({ platforms }) => {
        for (const platform of platforms) {
          this.details.delete(platform);
        }
        return sync();
      }),
      // A platform reconnecting may be the evidence an open post was waiting for.
      this.eventBus.on('platform.availability', sync),
      this.eventBus.on('integration.status', ({ name, status }) =>
        name === this.discord.name && status === IntegrationStatus.CONNECTED
          ? sync()
          : Promise.resolve()
      )
    );
    // Nothing is live yet, so this only schedules the end of a post left from before a restart.
    return sync();
  }

  async stop(): Promise<void> {
    // Timers first, so nothing new is queued while the work in progress finishes.
    this.stopped = true;
    this.subscriptions.clear();
    this.cancelEnd();
    this.cancelPreviewRefresh();
    const wasLive = this.heartbeat !== null;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    await this.queue;
    if (wasLive) {
      this.recordStillLive();
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    const run = this.queue.then(task).catch((error: unknown) => {
      this.logger.warn('Could not update the Discord go-live post', { error: messageOf(error) });
    });
    this.queue = run;
    return run;
  }

  /** Bring the post in line with which platforms are live now. */
  private async sync(): Promise<void> {
    const live = this.livePlatforms();
    let post = this.storedPost();

    if (live.length === 0) {
      if (this.heartbeat) {
        // The last platform just went offline.
        clearInterval(this.heartbeat);
        this.heartbeat = null;
        if (post) {
          post = { ...post, lastLiveAt: Date.now() };
          this.posts.save(post);
        }
      }
      if (post) {
        this.scheduleEnd(post.lastLiveAt + GO_LIVE_GRACE_MS - Date.now());
      }
      return;
    }

    this.cancelEnd();
    if (post && !this.continues(post, live)) {
      // A post left open from an earlier stream, which TuringMod never saw end.
      await this.end(post);
      post = null;
    }
    this.heartbeat ??= setInterval(() => void this.enqueue(() => this.tick()), HEARTBEAT_MS);

    const stream = await this.summarize(live, post?.stream ?? null);
    if (post) {
      post = { ...post, lastLiveAt: Date.now(), stream };
      this.posts.save(post);
      await this.showLive(post, live);
      return;
    }

    const channelId = this.discord.getNotificationChannelId();
    if (!channelId) {
      this.logger.debug('A platform went live, but Discord is not running');
      return;
    }
    const now = Date.now();
    const messageId = await this.discord.postMessage(channelId, renderLivePost(stream, live, now));
    this.posts.save({ channelId, messageId, lastLiveAt: now, previewStamp: now, stream });
    this.lastShown = JSON.stringify([stream, live]);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.enqueue(() => this.refreshPreview());
    }, PREVIEW_REFRESH_MS);
    this.logger.info('Announced the stream in Discord', { platforms: live });
  }

  /**
   * Edit the live post to match `post`, if what it shows has changed (or `refreshPreview`). The
   * preview is fetched again with every edit, since the frame it showed is out of date by then.
   */
  private async showLive(
    post: GoLivePost,
    live: StreamingPlatform[],
    refreshPreview = false
  ): Promise<void> {
    if (post.messageId === null) {
      return;
    }
    const shown = JSON.stringify([post.stream, live]);
    if (shown === this.lastShown && !refreshPreview) {
      return;
    }
    const updated = { ...post, previewStamp: Date.now() };
    try {
      await this.discord.editMessage(
        post.channelId,
        post.messageId,
        renderLivePost(updated.stream, live, updated.previewStamp)
      );
    } catch (error) {
      if (error instanceof DiscordMessageDeletedError) {
        this.logger.info('The Discord go-live post was deleted; not posting it again this stream');
        this.posts.save({ ...post, messageId: null });
        return;
      }
      throw error;
    }
    this.posts.save(updated);
    this.lastShown = shown;
  }

  private async refreshPreview(): Promise<void> {
    const post = this.storedPost();
    const live = this.livePlatforms();
    if (post && live.length > 0) {
      await this.showLive(post, live, true);
    }
  }

  /** Each minute while live: record it, or retry a post that couldn't be made. */
  private async tick(): Promise<void> {
    if (this.storedPost()) {
      this.recordStillLive();
    } else {
      await this.sync();
    }
  }

  private recordStillLive(): void {
    const post = this.storedPost();
    if (post && this.livePlatforms().length > 0) {
      this.posts.save({ ...post, lastLiveAt: Date.now() });
    }
  }

  /**
   * Whether platforms live now are still the post's stream: their broadcast began within the grace
   * period of its last sign of life. Without a start time, going live now is judged the same way.
   */
  private continues(post: GoLivePost, live: StreamingPlatform[]): boolean {
    const startedAt = this.earliestStart(live) ?? Date.now();
    return startedAt <= post.lastLiveAt + GO_LIVE_GRACE_MS;
  }

  private scheduleEnd(delayMs: number): void {
    this.cancelEnd();
    this.endTimer = setTimeout(
      () => {
        this.endTimer = null;
        void this.enqueue(() => this.tryEnd());
      },
      Math.max(0, delayMs)
    );
  }

  private cancelEnd(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  private cancelPreviewRefresh(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  /**
   * The grace period has run out: end the post if every platform it covered can be asked and
   * says it isn't live. Otherwise look again later; a platform reconnecting also brings this back.
   */
  private async tryEnd(): Promise<void> {
    const post = this.storedPost();
    if (!post || this.livePlatforms().length > 0) {
      return;
    }
    const remaining = post.lastLiveAt + GO_LIVE_GRACE_MS - Date.now();
    if (remaining > 0) {
      this.scheduleEnd(remaining);
      return;
    }

    for (const { platform } of post.stream.links) {
      const unavailable = this.controls.getUnavailableReason(platform);
      const live = unavailable === null ? await this.isLive(platform) : null;
      if (live !== false) {
        this.logger.debug('Not ending the go-live post yet', {
          platform,
          reason: unavailable ?? (live ? 'still live' : 'could not ask'),
        });
        this.scheduleEnd(GO_LIVE_GRACE_MS);
        return;
      }
    }
    await this.end(post);
  }

  /** True or false, or null if the platform couldn't be asked. */
  private async isLive(platform: StreamingPlatform): Promise<boolean | null> {
    try {
      return await this.controls.isLive(platform);
    } catch (error) {
      this.logger.warn('Could not ask a platform whether it is live', {
        platform,
        error: messageOf(error),
      });
      return null;
    }
  }

  /** Rewrite the post as ended and forget it. */
  private async end(post: GoLivePost): Promise<void> {
    // Forgotten whether or not the edit works: a post left open would swallow the next stream's
    // ping.
    this.posts.clear();
    this.lastShown = null;
    this.details.clear();
    this.cancelEnd();
    this.cancelPreviewRefresh();
    if (post.messageId === null) {
      return;
    }
    try {
      await this.discord.editMessage(
        post.channelId,
        post.messageId,
        renderEndedPost(post.stream, post.lastLiveAt)
      );
      this.logger.info('Marked the Discord go-live post as ended');
    } catch (error) {
      if (!(error instanceof DiscordMessageDeletedError)) {
        this.logger.warn('Could not mark the Discord go-live post as ended', {
          error: messageOf(error),
        });
      }
    }
  }

  /**
   * What the post should say: the name, title, game and preview from the first live platform that
   * has them, and links for every platform live now or earlier in this stream.
   */
  private async summarize(
    live: StreamingPlatform[],
    previous: StreamSummary | null
  ): Promise<StreamSummary> {
    const described: { platform: StreamingPlatform; details: PlatformDetails }[] = [];
    for (const platform of live) {
      const details = await this.describe(platform);
      if (details) {
        described.push({ platform, details });
      }
    }
    const first = described[0]?.details;
    if (!(first || previous)) {
      throw new Error('No live platform could be looked up');
    }

    const urls = new Map(previous?.links.map((link) => [link.platform, link.url]));
    for (const { platform, details } of described) {
      urls.set(platform, details.page.url);
    }
    const order = this.controls.platforms();
    const links = [...urls]
      .map(([platform, url]) => ({ platform, url }))
      .sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));

    const title = described.find(({ details }) => details.info?.title)?.details.info?.title;
    const game = described.find(({ details }) => details.info?.game)?.details.info?.game;
    return {
      channelName: first?.page.displayName ?? previous?.channelName ?? 'The stream',
      title: title ?? previous?.title ?? null,
      game: game ?? previous?.game ?? null,
      links,
      previewImageUrl: first?.page.previewImageUrl ?? previous?.previewImageUrl ?? null,
      startedAt: previous?.startedAt ?? this.earliestStart(live) ?? Date.now(),
    };
  }

  /** A live platform's page and stream info, looked up once and then remembered. */
  private async describe(platform: StreamingPlatform): Promise<PlatformDetails | null> {
    const known = this.details.get(platform);
    if (known) {
      return known;
    }
    try {
      const page = await this.controls.getChannelPage(platform);
      const info = await this.controls.getStreamInfo(platform).catch((error: unknown) => {
        this.logger.warn('Could not read the stream title', { platform, error: messageOf(error) });
        return null;
      });
      const details = { page, info };
      this.details.set(platform, details);
      return details;
    } catch (error) {
      this.logger.warn('Could not look up a live platform', { platform, error: messageOf(error) });
      return null;
    }
  }

  private livePlatforms(): StreamingPlatform[] {
    return this.liveStatus
      .getStates()
      .filter((state) => state.live)
      .map((state) => state.platform);
  }

  /** When the earliest of these platforms' broadcasts began, if any of them has said. */
  private earliestStart(live: StreamingPlatform[]): number | null {
    const starts = this.liveStatus
      .getStates()
      .flatMap(({ platform, startedAt }) =>
        live.includes(platform) && startedAt !== null ? [startedAt] : []
      );
    return starts.length > 0 ? Math.min(...starts) : null;
  }

  /** The stored post; one that can't be read is logged and dropped rather than blocking posts. */
  private storedPost(): GoLivePost | null {
    try {
      return this.posts.get();
    } catch (error) {
      this.logger.error('Dropping an unreadable go-live post', error);
      this.posts.clear();
      return null;
    }
  }
}
