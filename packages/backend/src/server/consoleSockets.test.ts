import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import { closeConsoleWss, rejectUpgrade } from './consoleSockets.js';

describe('rejectUpgrade', () => {
  it('answers with the status and survives the client resetting the connection', () => {
    const socket = new PassThrough();
    const written: string[] = [];
    socket.on('data', (chunk: Buffer) => written.push(chunk.toString()));

    rejectUpgrade(socket, 404, 'Not Found');

    expect(written.join('')).toContain('HTTP/1.1 404 Not Found');
    expect(() => socket.emit('error', new Error('read ECONNRESET'))).not.toThrow();
  });
});

describe('closeConsoleWss', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts off a console that never completes the closing handshake', async () => {
    vi.useFakeTimers();
    const clients = new Set<{ close: () => void; terminate: () => void }>();
    let closed: (() => void) | undefined;
    const unresponsive = {
      close: vi.fn(),
      terminate: vi.fn(() => {
        clients.delete(unresponsive);
        closed?.();
      }),
    };
    clients.add(unresponsive);
    // As ws does: the server's close completes once every client is gone.
    const wss = {
      clients,
      close: (callback: () => void) => {
        closed = callback;
      },
    } as unknown as WebSocketServer;

    const stopping = closeConsoleWss(wss);
    expect(unresponsive.close).toHaveBeenCalled();
    expect(unresponsive.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    await stopping;
    expect(unresponsive.terminate).toHaveBeenCalled();
  });
});
