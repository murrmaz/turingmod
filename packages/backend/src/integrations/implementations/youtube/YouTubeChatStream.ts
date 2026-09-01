import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { youtube_v3 } from 'googleapis';

/**
 * gRPC target for the YouTube live chat streaming service. The `dns:///` prefix is what Google's
 * own samples use; it lets grpc-js re-resolve the address across reconnects.
 */
const TARGET = 'dns:///youtube.googleapis.com:443';

/**
 * `liveChatMessages.streamList` is gRPC-only — it is absent from the YouTube v3 REST discovery
 * document, and therefore absent from the `googleapis` package (which is generated from discovery
 * and has no gRPC transport). So we load Google's published proto ourselves.
 *
 * `dist/` mirrors `src/` one level below `packages/backend`, so this relative path resolves to
 * `packages/backend/proto` under both `tsx` (dev) and the compiled build. Resolve from
 * `import.meta.url` rather than `process.cwd()` so it doesn't depend on where the server was
 * launched from.
 */
const PROTO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../proto/stream_list.proto'
);

/**
 * One response frame from the server stream. The proto's snake_case fields decode to camelCase
 * (proto-loader's default `keepCase: false`), which makes the items structurally identical to the
 * REST `youtube_v3.Schema$LiveChatMessage` — so the chat integration's existing message-normalizing
 * helpers work unchanged against them.
 */
export interface LiveChatMessageListResponse {
  items?: youtube_v3.Schema$LiveChatMessage[];
  nextPageToken?: string;
  /** Set when the underlying stream goes offline. */
  offlineAt?: string;
}

/**
 * The subset of grpc-js's readable stream the chat integration actually uses.
 *
 * Note the absence of `removeAllListeners`. Cancelling a call makes grpc-js deliver a CANCELLED
 * status on a later tick, which it surfaces by emitting `'error'` on the stream; detaching the
 * error listener first would leave that emit unhandled, and Node throws on an unhandled `'error'`.
 * Callers must leave their listeners attached for the life of the call and ignore events from a
 * call they no longer consider current.
 */
export interface LiveChatStreamCall {
  on(event: 'data', listener: (response: LiveChatMessageListResponse) => void): this;
  on(event: 'error', listener: (error: grpc.ServiceError) => void): this;
  on(event: 'end', listener: () => void): this;
  cancel(): void;
}

interface StreamListClient extends grpc.Client {
  // biome-ignore lint/style/useNamingConvention: RPC name is fixed by stream_list.proto.
  StreamList(
    request: {
      liveChatId: string;
      part: string[];
      pageToken?: string;
    },
    metadata: grpc.Metadata
  ): LiveChatStreamCall;
}

type StreamListPackage = {
  youtube: {
    api: {
      v3: {
        // biome-ignore lint/style/useNamingConvention: service name is fixed by stream_list.proto.
        V3DataLiveChatMessageService: grpc.ServiceClientConstructor;
      };
    };
  };
};

/**
 * Thin wrapper around the `youtube.api.v3.V3DataLiveChatMessageService/StreamList` server-streaming
 * RPC, so gRPC and protobuf details stay out of YouTubeChatIntegration.
 *
 * One channel is created lazily and reused across reconnects; only `close()` tears it down.
 */
export class YouTubeChatStream {
  private client: StreamListClient | null = null;

  /**
   * Open a server stream of live chat messages.
   *
   * @param accessToken A currently-valid OAuth access token. gRPC metadata is fixed for the life of
   *   the call, so the caller must supply a fresh token on every (re)connect rather than relying on
   *   the OAuth client to refresh mid-stream.
   * @param pageToken Resume point from a previous response; omit to start from chat history.
   */
  stream(liveChatId: string, accessToken: string, pageToken?: string): LiveChatStreamCall {
    const client = this.getClient();

    const metadata = new grpc.Metadata();
    metadata.set('authorization', `Bearer ${accessToken}`);

    return client.StreamList(
      {
        liveChatId,
        // Matches the fields the chat integration reads when normalizing a message.
        part: ['snippet', 'authorDetails'],
        ...(pageToken === undefined ? {} : { pageToken }),
      },
      metadata
    );
  }

  /** Tear down the channel. Safe to call when no channel was ever created. */
  close(): void {
    this.client?.close();
    this.client = null;
  }

  private getClient(): StreamListClient {
    if (this.client) {
      return this.client;
    }

    const definition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(definition) as unknown as StreamListPackage;
    const ServiceClient = proto.youtube.api.v3.V3DataLiveChatMessageService;

    // The generated constructor is typed as a generic ServiceClient; the RPC methods are attached
    // dynamically from the proto, so the concrete shape has to be asserted.
    this.client = new ServiceClient(
      TARGET,
      grpc.credentials.createSsl()
    ) as unknown as StreamListClient;
    return this.client;
  }
}
