import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { EventBus } from './EventBus.js';
import { failureReporter, RepeatingFailures } from './failures.js';

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
