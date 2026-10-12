import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../utils/Logger.js';
import { EventBus } from './EventBus.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

describe('EventBus', () => {
  it('logs an async handler rejection from emitSync instead of leaving it unhandled', async () => {
    const logger = makeLogger();
    const bus = new EventBus(logger);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      bus.on('thing', () => Promise.reject(new Error('boom')));
      const after = vi.fn();
      bus.on('thing', after);

      bus.emitSync('thing', {});

      expect(after).toHaveBeenCalled();
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
      // Give Node a turn to report an unhandled rejection, if there were one.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('awaits and catches a once() handler through emit', async () => {
    const logger = makeLogger();
    const bus = new EventBus(logger);
    const handler = vi.fn(() => Promise.reject(new Error('boom')));
    bus.once('thing', handler);

    await bus.emit('thing', {});
    await bus.emit('thing', {});

    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
