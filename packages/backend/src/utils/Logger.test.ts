import { describe, expect, it } from 'vitest';
import { Logger } from './Logger.js';

/** A logger whose JSON lines are collected, parsed, instead of written to stdout. */
function capturedLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = new Logger({
    level: 'trace',
    destination: { write: (line: string) => lines.push(JSON.parse(line)) },
  });
  return { logger, lines };
}

describe('Logger', () => {
  it('logs an Error passed to warn with its message and stack', () => {
    const { logger, lines } = capturedLogger();

    logger.warn('Could not reply', new Error('chat down'));

    expect(lines[0]).toMatchObject({
      msg: 'Could not reply',
      err: { type: 'Error', message: 'chat down', stack: expect.stringContaining('chat down') },
    });
  });

  it('merges structured fields into the line rather than nesting them', () => {
    const { logger, lines } = capturedLogger();

    logger.info('Break overlay applied', { sceneItems: 3, inputs: 1 });

    expect(lines[0]).toMatchObject({ msg: 'Break overlay applied', sceneItems: 3, inputs: 1 });
    expect(lines[0]).not.toHaveProperty('0');
  });

  it('serializes an Error held in an `error` field', () => {
    const { logger, lines } = capturedLogger();

    logger.debug('Failed', { error: new Error('boom') });

    expect(lines[0]).toMatchObject({ error: { message: 'boom' } });
  });

  it('keeps any other value under `detail`', () => {
    const { logger, lines } = capturedLogger();

    logger.info('Integration startup order:', ['obs', 'sound']);
    logger.warn('Thrown', 'a string');

    expect(lines[0]).toMatchObject({ detail: ['obs', 'sound'] });
    expect(lines[1]).toMatchObject({ detail: 'a string' });
  });

  it('logs a caught Error passed to error with its context', () => {
    const { logger, lines } = capturedLogger();

    logger.error('Failed to start', new Error('no socket'), { integration: 'obs' });
    logger.error('Failed with a string', 'nope');

    expect(lines[0]).toMatchObject({ err: { message: 'no socket' }, integration: 'obs' });
    expect(lines[1]).toMatchObject({ error: 'nope' });
  });
});
