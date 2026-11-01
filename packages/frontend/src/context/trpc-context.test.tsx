import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrpcProvider, useConnection } from './trpc-context';

interface FakeSocket {
  close: () => Promise<void>;
  report: (state: 'pending' | 'connecting' | 'idle', error?: Error) => void;
}

const sockets = vi.hoisted<FakeSocket[]>(() => []);

// The WebSocket is all that's faked: the states it reports are what TrpcProvider acts on.
vi.mock('@trpc/client', async (original) => ({
  ...(await original<typeof import('@trpc/client')>()),
  createWSClient: () => {
    let listener: ((value: { state: string; error?: Error }) => void) | undefined;
    const socket = {
      close: vi.fn(async () => {}),
      report: (state: string, error?: Error) => {
        act(() => listener?.({ state, ...(error ? { error } : {}) }));
      },
      connectionState: {
        get: () => ({ state: 'pending' }),
        subscribe: (observer: { next: NonNullable<typeof listener> }) => {
          listener = observer.next;
          return { unsubscribe: () => {} };
        },
      },
    };
    sockets.push(socket);
    return socket;
  },
}));

function Status() {
  const { connectionState, retry } = useConnection();
  return (
    <button type="button" onClick={retry}>
      {connectionState}
    </button>
  );
}

function setup() {
  const view = render(
    <TrpcProvider>
      <Status />
    </TrpcProvider>
  );
  const socket = (index: number): FakeSocket => {
    const found = sockets[index];
    if (!found) {
      throw new Error(`No socket #${index} was opened`);
    }
    return found;
  };
  return { user: userEvent.setup(), socket, ...view };
}

const status = () => screen.getByRole('button');

describe('TrpcProvider', () => {
  beforeEach(() => {
    sockets.length = 0;
  });

  it('is connecting until the first connection opens', () => {
    const { socket } = setup();
    expect(status()).toHaveTextContent('connecting');

    socket(0).report('connecting');
    expect(status()).toHaveTextContent('connecting');

    socket(0).report('pending');
    expect(status()).toHaveTextContent('connected');
  });

  it('says reconnecting once a connection has dropped, or the first attempt failed', () => {
    const { socket } = setup();

    socket(0).report('connecting', new Error('Refused'));
    expect(status()).toHaveTextContent('reconnecting');

    socket(0).report('pending');
    socket(0).report('connecting');
    expect(status()).toHaveTextContent('reconnecting');
  });

  it('opens a new connection on Retry while disconnected, closing the old one', async () => {
    const { user, socket } = setup();
    socket(0).report('pending');
    socket(0).report('connecting');

    await user.click(status());

    expect(sockets).toHaveLength(2);
    expect(socket(0).close).toHaveBeenCalled();
  });

  it('does nothing on Retry while connected', async () => {
    const { user, socket } = setup();
    socket(0).report('pending');

    await user.click(status());

    expect(sockets).toHaveLength(1);
    expect(socket(0).close).not.toHaveBeenCalled();
  });

  it('retries by the state now, not the state when Retry was first made', async () => {
    const { user, socket } = setup();
    socket(0).report('connecting', new Error('Refused'));
    socket(0).report('pending');

    await user.click(status());
    expect(sockets).toHaveLength(1);

    socket(0).report('connecting');
    await user.click(status());
    expect(sockets).toHaveLength(2);
  });

  it('closes its connection when unmounted', () => {
    const { socket, unmount } = setup();

    unmount();

    expect(socket(0).close).toHaveBeenCalled();
  });
});
