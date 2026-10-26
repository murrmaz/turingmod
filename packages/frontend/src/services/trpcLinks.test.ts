import { createTRPCUntypedClient, TRPCClientError, type TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { describe, expect, it } from 'vitest';
import { ConnectionError } from './connection';
import { failWhileDisconnected } from './trpcLinks';

type State = 'idle' | 'connecting' | 'pending';

/** A client whose connection is in `state`, over a server that answers with `answer`. */
function clientWith(state: State, answer: (observer: { next: (v: unknown) => void }) => void) {
  const sent: string[] = [];
  const wsClient = {
    connectionState: { get: () => ({ type: 'state', state, error: null }) },
  } as unknown as Parameters<typeof failWhileDisconnected>[0];
  const server: TRPCLink<AnyRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        sent.push(op.path);
        answer({
          next: (result) => {
            if (result instanceof Error) {
              observer.error(TRPCClientError.from(result));
            } else {
              observer.next({ result: { type: 'data', data: result } });
              observer.complete();
            }
          },
        });
      });
  return {
    sent,
    client: createTRPCUntypedClient({ links: [failWhileDisconnected(wsClient), server] }),
  };
}

describe('failWhileDisconnected', () => {
  it('fails a mutation at once while disconnected, without sending it', async () => {
    const { client, sent } = clientWith('connecting', () => {});

    const error = await client.mutation('integrations.start', {}).catch((e: unknown) => e);

    expect((error as Error).cause).toBeInstanceOf(ConnectionError);
    expect(sent).toEqual([]);
  });

  it('sends a mutation while connected', async () => {
    const { client } = clientWith('pending', (server) => server.next('done'));

    await expect(client.mutation('integrations.start', {})).resolves.toBe('done');
  });

  it('reports a connection lost under a request as a ConnectionError', async () => {
    const { client } = clientWith('pending', (server) =>
      server.next(new Error('WebSocket closed'))
    );

    const error = await client.mutation('integrations.start', {}).catch((e: unknown) => e);

    expect((error as Error).cause).toBeInstanceOf(ConnectionError);
  });

  it('lets a subscription wait for the connection', () => {
    const { client, sent } = clientWith('connecting', () => {});

    client.subscription('integrations.watch', undefined, {}).unsubscribe();

    expect(sent).toEqual(['integrations.watch']);
  });
});
