import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { google, type youtube_v3 } from 'googleapis';
import { z } from 'zod';
import { ClientCache } from '../../ClientCache.js';
import { JsonFrameParser } from './parseJsonFrames.js';
import type { YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

/**
 * One chat message, as far as YouTubeChatIntegration reads it. Google's data, so not strict and
 * only the fields used; any of them may be absent or null, as googleapis' own types allow.
 */
const LiveChatMessageSchema = z.object({
  id: z.string().nullish(),
  snippet: z
    .object({
      displayMessage: z.string().nullish(),
      textMessageDetails: z.object({ messageText: z.string().nullish() }).nullish(),
    })
    .nullish(),
  authorDetails: z
    .object({
      channelId: z.string().nullish(),
      displayName: z.string().nullish(),
      isChatOwner: z.boolean().nullish(),
      isChatModerator: z.boolean().nullish(),
      isChatSponsor: z.boolean().nullish(),
      isVerified: z.boolean().nullish(),
    })
    .nullish(),
});

/**
 * One response frame from the server stream. googleapis types the method's response as a
 * `LiveChatMessageListResponse`, but that's its code generator describing a single frame, not a
 * checked shape, so each frame is parsed here, where it enters.
 */
const LiveChatFrameSchema = z.object({
  items: z.array(LiveChatMessageSchema).nullish(),
  nextPageToken: z.string().nullish(),
  /** Set once the broadcast has gone offline. */
  offlineAt: z.string().nullish(),
});

export type LiveChatMessage = z.infer<typeof LiveChatMessageSchema>;
export type LiveChatFrame = z.infer<typeof LiveChatFrameSchema>;

/**
 * The subset of the underlying stream the chat integration uses.
 *
 * Nothing here removes listeners. The request is opened asynchronously, so events can still be in
 * flight when the caller moves on; callers must leave their listeners attached for the life of the
 * call and ignore events from a call they no longer consider current.
 */
export interface LiveChatStreamCall {
  on(event: 'data', listener: (frame: LiveChatFrame) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'end', listener: () => void): this;
  cancel(): void;
}

/**
 * The live handle returned by {@link YouTubeChatStream.stream}. It is returned synchronously while
 * the HTTP request is still being opened, so the caller can attach listeners before anything can
 * be emitted.
 */
class StreamCall extends EventEmitter implements LiveChatStreamCall {
  readonly controller = new AbortController();
  private cancelled = false;
  private body: Readable | null = null;

  /** True once {@link cancel} has been called; the pump uses this to drop a late-arriving body. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  attachBody(body: Readable): void {
    this.body = body;
  }

  /**
   * Aborting makes the in-flight request reject and the body emit an abort error. Those are our
   * own doing, so emission is suppressed from here on rather than surfaced to the caller as a
   * stream failure that would trigger a reconnect.
   */
  cancel(): void {
    this.cancelled = true;
    this.controller.abort();
    this.body?.destroy();
    this.body = null;
  }

  emitData(frame: LiveChatFrame): void {
    if (!this.cancelled) {
      this.emit('data', frame);
    }
  }

  emitError(error: unknown): void {
    if (!this.cancelled) {
      this.emit('error', error);
    }
  }

  emitEnd(): void {
    if (!this.cancelled) {
      this.emit('end');
    }
  }
}

/**
 * Thin wrapper around `youtube.v3.liveChat.messages.stream`, the server-streaming live chat RPC,
 * so transport details stay out of YouTubeChatIntegration.
 *
 * The method is easy to miss in the `googleapis` package: it is named `stream` (not `streamList`,
 * its gRPC name) and hangs off a separate nested resource — `client.youtube.v3.liveChat.messages`
 * — rather than the top-level `client.liveChatMessages` resource that holds list/insert/delete.
 *
 * Requests go out with `responseType: 'stream'`, so the body arrives as a Readable of frames that
 * {@link JsonFrameParser} splits. Awaiting the ordinary overload instead would buffer the entire
 * response and deliver messages only once the broadcast ended.
 */
export class YouTubeChatStream {
  private readonly clients = new ClientCache((auth: YouTubeOAuth2Client) =>
    google.youtube({ version: 'v3', auth })
  );

  /**
   * Open a server stream of live chat messages.
   *
   * @param authClient The authorized OAuth2 client, which attaches an access token to each request
   *   and refreshes it on demand.
   * @param pageToken Resume point from a previous response; omit to start from chat history.
   */
  stream(
    liveChatId: string,
    authClient: YouTubeOAuth2Client,
    pageToken?: string
  ): LiveChatStreamCall {
    const call = new StreamCall();
    void this.pump(this.clients.get(authClient), call, liveChatId, pageToken);
    return call;
  }

  /** Drop the cached client. Safe to call when none was ever built. */
  close(): void {
    this.clients.clear();
  }

  private async pump(
    client: youtube_v3.Youtube,
    call: StreamCall,
    liveChatId: string,
    pageToken?: string
  ): Promise<void> {
    try {
      const response = await client.youtube.v3.liveChat.messages.stream(
        {
          liveChatId,
          // Matches the fields the chat integration reads when normalizing a message.
          part: ['snippet', 'authorDetails'],
          ...(pageToken === undefined ? {} : { pageToken }),
        },
        {
          responseType: 'stream',
          signal: call.controller.signal,
          // The stream is open for as long as the broadcast lasts; any timeout would end it early.
          timeout: 0,
        }
      );

      const body = response.data as unknown as Readable;

      // A cancel that landed while the request was opening leaves us holding a body nobody wants.
      if (call.isCancelled) {
        body.destroy();
        return;
      }
      call.attachBody(body);

      const parser = new JsonFrameParser();
      body.setEncoding('utf8');

      body.on('data', (chunk: string) => {
        let frames: unknown[];
        try {
          frames = parser.push(chunk);
        } catch (error) {
          // Malformed or unbounded body: there is no resyncing mid-stream, so end the call. The
          // integration treats it as unexpected, logs it and goes idle.
          body.destroy();
          call.emitError(error);
          return;
        }
        for (const frame of frames) {
          const parsed = LiveChatFrameSchema.safeParse(frame);
          if (!parsed.success) {
            // Likewise for a frame that isn't the shape we read: chat shouldn't quietly go missing.
            body.destroy();
            call.emitError(
              new Error(`Unexpected YouTube live chat frame:\n${z.prettifyError(parsed.error)}`)
            );
            return;
          }
          call.emitData(parsed.data);
        }
      });
      body.on('error', (error: unknown) => call.emitError(error));
      body.on('end', () => call.emitEnd());
    } catch (error) {
      call.emitError(error);
    }
  }
}
