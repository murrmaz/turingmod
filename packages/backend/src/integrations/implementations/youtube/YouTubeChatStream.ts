import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { google, type youtube_v3 } from 'googleapis';
import { JsonFrameParser } from './parseJsonFrames.js';
import type { YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

/**
 * One response frame from the server stream — the client's own type, so the items are genuinely
 * `Schema$LiveChatMessage` rather than something that merely resembles it.
 */
export type LiveChatMessageListResponse = youtube_v3.Schema$LiveChatMessageListResponse;

/**
 * The subset of the underlying stream the chat integration uses.
 *
 * Nothing here removes listeners. The request is opened asynchronously, so events can still be in
 * flight when the caller moves on; callers must leave their listeners attached for the life of the
 * call and ignore events from a call they no longer consider current.
 */
export interface LiveChatStreamCall {
  on(event: 'data', listener: (response: LiveChatMessageListResponse) => void): this;
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

  emitData(response: LiveChatMessageListResponse): void {
    if (!this.cancelled) {
      this.emit('data', response);
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
  private client: youtube_v3.Youtube | null = null;
  private clientAuth: YouTubeOAuth2Client | null = null;

  /**
   * Open a server stream of live chat messages.
   *
   * @param authClient The authorized OAuth2 client. Unlike the previous gRPC transport, no access
   *   token is passed in: the client attaches one per request and refreshes it on demand.
   * @param pageToken Resume point from a previous response; omit to start from chat history.
   */
  stream(
    liveChatId: string,
    authClient: YouTubeOAuth2Client,
    pageToken?: string
  ): LiveChatStreamCall {
    const call = new StreamCall();
    void this.pump(this.getClient(authClient), call, liveChatId, pageToken);
    return call;
  }

  /** Drop the cached client. Safe to call when none was ever built. */
  close(): void {
    this.client = null;
    this.clientAuth = null;
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
          // Malformed or unbounded body: there is no resyncing mid-stream, so end the call and let
          // the integration reconnect from its last page token.
          body.destroy();
          call.emitError(error);
          return;
        }
        for (const frame of frames) {
          call.emitData(frame as LiveChatMessageListResponse);
        }
      });
      body.on('error', (error: unknown) => call.emitError(error));
      body.on('end', () => call.emitEnd());
    } catch (error) {
      call.emitError(error);
    }
  }

  /**
   * Build (or reuse) the API client. Keyed on the auth client's identity so a re-authorization,
   * which replaces the OAuth2 client, doesn't leave us streaming with a dead one.
   */
  private getClient(authClient: YouTubeOAuth2Client): youtube_v3.Youtube {
    if (this.client && this.clientAuth === authClient) {
      return this.client;
    }

    this.client = google.youtube({ version: 'v3', auth: authClient });
    this.clientAuth = authClient;
    return this.client;
  }
}
