import { PermissionLevel, type StreamingPlatform } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { Logger } from '../utils/Logger.js';
import type { ChatMessageEvent } from './chatMessage.js';

/**
 * Keeps TuringMod from acting on its own chat messages.
 *
 * TuringMod posts with the broadcaster's login, so its messages come back through ingest as the
 * broadcaster's, indistinguishable by sender from the streamer typing. The platform's message id
 * is the one thing that tells them apart: each façade sends through `record()`, which remembers
 * the id the platform returns, and `start()` gates the raw `chat.received` feed, republishing
 * only other people's messages as `chat.message`. Nothing downstream — moderation, commands,
 * lurk, clip collection — ever sees TuringMod's own words, so an echoed payload can't run with
 * the broadcaster's permission and no reaction can feed back into a message storm.
 *
 * Ingest can deliver a message before the send call that posted it returns, so a broadcaster
 * message arriving while a send is in flight waits for it to settle before being judged. Other
 * people's messages can't be ours and pass straight through.
 */
@injectable()
@singleton()
export class OwnChatMessages {
  /** How long a sent id is remembered; ingest delivers in seconds, so this is generous. */
  static readonly RETENTION_MS = 5 * 60_000;

  /** `platform:messageId` → when it was sent. */
  private sent = new Map<string, number>();
  private inFlight = new Map<StreamingPlatform, Set<Promise<unknown>>>();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'OwnChatMessages' });
  }

  /** Republish incoming chat as `chat.message`, minus TuringMod's own messages. */
  start(): void {
    this.eventBus.on<ChatMessageEvent>('chat.received', async (event) => {
      if (await this.isOwn(event)) {
        this.logger.debug('Ignoring own chat message', { platform: event.platform });
        return;
      }
      await this.eventBus.emit<ChatMessageEvent>('chat.message', event);
    });
  }

  /**
   * Run a send and remember the id of the message it posted. `send` resolves to that id, or null
   * when the platform accepted the request but posted nothing (e.g. AutoMod held the message).
   */
  async record(platform: StreamingPlatform, send: () => Promise<string | null>): Promise<void> {
    const pending = send();
    let sends = this.inFlight.get(platform);
    if (!sends) {
      sends = new Set();
      this.inFlight.set(platform, sends);
    }
    sends.add(pending);
    try {
      const id = await pending;
      if (id) {
        this.prune();
        this.sent.set(`${platform}:${id}`, Date.now());
      }
    } finally {
      sends.delete(pending);
    }
  }

  /** Whether TuringMod posted this message. */
  async isOwn(event: ChatMessageEvent): Promise<boolean> {
    if (event.permissionLevel !== PermissionLevel.BROADCASTER || !event.messageId) {
      return false;
    }
    const sends = this.inFlight.get(event.platform);
    if (sends && sends.size > 0) {
      await Promise.allSettled([...sends]);
    }
    return this.sent.has(`${event.platform}:${event.messageId}`);
  }

  private prune(): void {
    const cutoff = Date.now() - OwnChatMessages.RETENTION_MS;
    for (const [key, sentAt] of this.sent) {
      if (sentAt >= cutoff) {
        break; // insertion order is send order
      }
      this.sent.delete(key);
    }
  }
}
