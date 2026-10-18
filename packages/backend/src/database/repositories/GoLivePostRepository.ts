import { singleton } from 'tsyringe';
import { type GoLivePost, GoLivePostSchema } from '../../live/goLivePost.js';
import { DatabaseManager } from '../DatabaseManager.js';

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
    return row ? GoLivePostSchema.parse(JSON.parse(row.post)) : null;
  }

  save(post: GoLivePost): void {
    this.db.run(
      `INSERT INTO go_live_post (id, post, saved_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET post = excluded.post, saved_at = excluded.saved_at`,
      [JSON.stringify(post), Date.now()]
    );
  }

  clear(): void {
    this.db.run('DELETE FROM go_live_post');
  }
}
