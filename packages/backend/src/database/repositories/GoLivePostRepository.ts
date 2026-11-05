import { StreamingPlatform } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { parseOrThrow } from '../../utils/parseOrThrow.js';
import { DatabaseManager } from '../DatabaseManager.js';

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

/**
 * The Discord go-live post of the stream in progress (`GoLivePost`): saved when it is posted,
 * cleared once the stream is over. It outlives TuringMod, so a restart mid-stream edits the same
 * post instead of announcing the stream again.
 */
@singleton()
export class GoLivePostRepository {
  constructor(private db: DatabaseManager) {}

  /** The stored post, or null if no stream is in progress. Throws if what's stored isn't valid. */
  get(): GoLivePost | null {
    const row = this.db.queryOne<{ post: string }>('SELECT post FROM go_live_post WHERE id = 1');
    return row
      ? parseOrThrow(GoLivePostSchema, JSON.parse(row.post), 'The stored go-live post is not valid')
      : null;
  }

  save(post: GoLivePost): void {
    this.db.run(
      `INSERT INTO go_live_post (id, post, saved_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET post = excluded.post, saved_at = excluded.saved_at`,
      [JSON.stringify(parseOrThrow(GoLivePostSchema, post, 'Not a valid go-live post')), Date.now()]
    );
  }

  clear(): void {
    this.db.run('DELETE FROM go_live_post');
  }
}
