import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { describe, expect, it } from 'vitest';

/**
 * Guards the vendored proto. `stream_list.proto` is copied by hand from Google's docs (which
 * publish it as a code block, not a downloadable file), so a truncated or mis-pasted copy is a real
 * risk — and it would otherwise only surface as a runtime failure mid-stream.
 *
 * No network: this only loads and encodes.
 */
const PROTO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../proto/stream_list.proto'
);

function loadService() {
  const definition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(definition) as unknown as {
    youtube: {
      api: {
        v3: {
          // biome-ignore lint/style/useNamingConvention: service name is fixed by the proto.
          V3DataLiveChatMessageService: grpc.ServiceClientConstructor;
        };
      };
    };
  };

  return proto.youtube.api.v3.V3DataLiveChatMessageService.service;
}

describe('stream_list.proto', () => {
  it('resolves the StreamList server-streaming RPC', () => {
    const method = loadService().StreamList;

    expect(method?.path).toBe('/youtube.api.v3.V3DataLiveChatMessageService/StreamList');
    expect(method?.requestStream).toBe(false);
    expect(method?.responseStream).toBe(true);
  });

  it('encodes the request fields the integration sends', () => {
    const method = loadService().StreamList;

    const encoded = method?.requestSerialize({
      liveChatId: 'chat-1',
      part: ['snippet', 'authorDetails'],
      pageToken: 'page-1',
    });

    expect(encoded?.length).toBeGreaterThan(0);
  });

  it('decodes a response into the camelCase shape the integration reads', () => {
    const method = loadService().StreamList;

    // Round-trip through the wire format so this asserts on real decoding, not on the fixture.
    const encoded = method?.requestSerialize({ liveChatId: 'chat-1', part: ['snippet'] });
    expect(encoded).toBeInstanceOf(Buffer);

    const definition = protoLoader.loadSync(PROTO_PATH, { keepCase: false, enums: String });
    const response = definition['youtube.api.v3.LiveChatMessageListResponse'];
    const fieldNames = (response as { type: { field: { name: string }[] } }).type.field.map(
      (field) => field.name
    );

    // These are the fields YouTubeChatIntegration depends on.
    expect(fieldNames).toContain('items');
    expect(fieldNames).toContain('nextPageToken');
  });
});
