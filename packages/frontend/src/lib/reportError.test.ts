import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionError } from '@/services/WebSocketClient';
import { reportActionError, reportLoadError } from './reportError';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

describe('reportError', () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it('toasts a failed action, even one that failed for want of a connection', () => {
    reportActionError("Couldn't start obs", new ConnectionError('Not connected to TuringMod'));

    expect(toastError).toHaveBeenCalledWith("Couldn't start obs", {
      description: 'Not connected to TuringMod',
    });
  });

  it('toasts a failed load the backend answered with an error', () => {
    reportLoadError("Couldn't load commands", new Error('Database is locked'));

    expect(toastError).toHaveBeenCalledWith("Couldn't load commands", {
      id: "Couldn't load commands",
      description: 'Database is locked',
    });
  });

  it('leaves a load that failed for want of a connection to the banner', () => {
    reportLoadError("Couldn't load commands", new ConnectionError('Connection closed'));

    expect(toastError).not.toHaveBeenCalled();
  });
});
