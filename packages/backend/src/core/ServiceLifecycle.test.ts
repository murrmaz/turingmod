import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { EventBus } from './EventBus.js';
import { type IService, onConnected, ServiceLifecycle, Subscriptions } from './ServiceLifecycle.js';

function setup() {
  const logger = new Logger({ level: 'silent' });
  const errorSpy = vi.spyOn(logger, 'error');
  vi.spyOn(logger, 'child').mockReturnValue(logger);
  const lifecycle = new ServiceLifecycle(logger);
  const calls: string[] = [];
  const service = (name: string, overrides: Partial<IService> = {}): IService => ({
    start: () => {
      calls.push(`start ${name}`);
    },
    stop: () => {
      calls.push(`stop ${name}`);
    },
    ...overrides,
  });
  return { lifecycle, calls, service, errorSpy };
}

describe('ServiceLifecycle', () => {
  it('starts services in order and stops them in reverse', async () => {
    const { lifecycle, calls, service } = setup();
    lifecycle.add(service('a'));
    lifecycle.add(service('b'));
    lifecycle.add({ stop: () => void calls.push('stop startless') });

    await lifecycle.startAll();
    await lifecycle.stopAll();

    expect(calls).toEqual(['start a', 'start b', 'stop startless', 'stop b', 'stop a']);
  });

  it('keeps stopping the rest when one service fails to stop', async () => {
    const { lifecycle, calls, service, errorSpy } = setup();
    lifecycle.add(service('a'));
    lifecycle.add(service('b', { stop: () => Promise.reject(new Error('boom')) }));
    await lifecycle.startAll();

    await lifecycle.stopAll();

    expect(calls).toContain('stop a');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('stops only services that started, and each only once', async () => {
    const { lifecycle, calls, service } = setup();
    lifecycle.add(service('a'));
    lifecycle.add(service('b', { start: () => Promise.reject(new Error('no')) }));
    lifecycle.add(service('c'));

    await expect(lifecycle.startAll()).rejects.toThrow('no');
    await lifecycle.stopAll();
    await lifecycle.stopAll();

    expect(calls).toEqual(['start a', 'stop a']);
  });
});

describe('Subscriptions', () => {
  it('releases every unsubscriber once', () => {
    const subscriptions = new Subscriptions();
    const first = vi.fn();
    const second = vi.fn();
    subscriptions.add(first, second);

    subscriptions.clear();
    subscriptions.clear();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('onConnected', () => {
  it('runs only when this integration reaches CONNECTED, until unsubscribed', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    const handler = vi.fn();
    const unsubscribe = onConnected(eventBus, { name: 'obs' }, handler);
    const status = (name: string, status: IntegrationStatus) =>
      eventBus.emit('integration.status', { name, status });

    await status('discord', IntegrationStatus.CONNECTED);
    await status('obs', IntegrationStatus.CONNECTING);
    expect(handler).not.toHaveBeenCalled();

    await status('obs', IntegrationStatus.CONNECTED);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    await status('obs', IntegrationStatus.CONNECTED);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('waits for an async handler, as a subscriber does', async () => {
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    let finished = false;
    onConnected(eventBus, { name: 'obs' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      finished = true;
    });

    await eventBus.emit('integration.status', {
      name: 'obs',
      status: IntegrationStatus.CONNECTED,
    });

    expect(finished).toBe(true);
  });
});
