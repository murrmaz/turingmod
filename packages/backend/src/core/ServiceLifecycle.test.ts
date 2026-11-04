import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { EventBus } from './EventBus.js';
import {
  failureReporter,
  type IService,
  onConnected,
  RepeatingFailures,
  ServiceLifecycle,
  Subscriptions,
} from './ServiceLifecycle.js';

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

describe('failureReporter', () => {
  function reporter() {
    const logger = new Logger({ level: 'silent' });
    const logged = vi.spyOn(logger, 'error');
    const eventBus = new EventBus(logger);
    const published = vi.fn();
    eventBus.on('service.error', published);
    return { report: failureReporter(eventBus, logger, 'Breaks'), logged, published };
  }

  it('logs the caught error itself and publishes its message after the text', () => {
    const { report, logged, published } = reporter();
    const error = new Error('refused');

    report('Could not unmute the mic.', error);

    expect(logged).toHaveBeenCalledWith('Could not unmute the mic.', error);
    expect(published).toHaveBeenCalledWith({
      service: 'Breaks',
      message: 'Could not unmute the mic. refused',
    });
  });

  it('logs and publishes a failure with no caught error', () => {
    const { report, logged, published } = reporter();

    report('OBS is not connected.');

    expect(logged).toHaveBeenCalledOnce();
    expect(published).toHaveBeenCalledWith({ service: 'Breaks', message: 'OBS is not connected.' });
  });
});

describe('RepeatingFailures', () => {
  function setup() {
    const logger = new Logger({ level: 'silent' });
    const logged = vi.spyOn(logger, 'error');
    const report = vi.fn();
    return { failures: new RepeatingFailures(report, logger), report, logged };
  }

  it('reports the first failure of a run and only logs the rest', () => {
    const { failures, report, logged } = setup();
    const error = new Error('down');

    failures.failed('reply', 'Could not reply.', error);
    failures.failed('reply', 'Could not reply.', error);
    failures.failed('reply', 'Could not reply.', error);

    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('Could not reply.', error);
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it('reports again once that kind has recovered', () => {
    const { failures, report } = setup();

    failures.failed('reply', 'Could not reply.');
    failures.recovered('reply');
    failures.failed('reply', 'Could not reply.');

    expect(report).toHaveBeenCalledTimes(2);
  });

  it('keeps kinds apart', () => {
    const { failures, report } = setup();

    failures.failed('reply', 'Could not reply.');
    failures.failed('timeout', 'Could not time out.');
    failures.recovered('timeout');
    failures.failed('reply', 'Could not reply.');

    expect(report).toHaveBeenCalledTimes(2);
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
