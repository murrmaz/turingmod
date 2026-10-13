import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../utils/Logger.js';

/** A player process that runs until it is killed or told to finish. */
class FakeChild extends EventEmitter {
  kill = vi.fn(() => {
    this.emit('exit', null, 'SIGTERM');
    return true;
  });
  finish(code = 0) {
    this.emit('exit', code, null);
  }
}

const children: FakeChild[] = [];
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }),
}));

const { SoundIntegration } = await import('./SoundIntegration.js');

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

describe('SoundIntegration playback control', () => {
  let logger: ReturnType<typeof makeLogger>;
  let sound: InstanceType<typeof SoundIntegration>;
  const platform = process.platform;

  beforeEach(() => {
    vi.useFakeTimers();
    children.length = 0;
    // macOS's player needs no startup probe, which keeps this about playback alone.
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    logger = makeLogger();
    sound = new SoundIntegration(logger);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    vi.useRealTimers();
  });

  it('cuts a clip off after its maximum duration, as a normal end', async () => {
    const playing = sound.playSound('/clips/jumpscare.mp3', 0.5, 2000);
    expect(children[0]?.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    await playing;

    expect(children[0]?.kill).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('lets a clip that ends on its own finish without killing it', async () => {
    const playing = sound.playSound('/clips/bonk.mp3', 0.5, 2000);
    children[0]?.finish();
    await playing;
    await vi.advanceTimersByTimeAsync(2000);

    expect(children[0]?.kill).not.toHaveBeenCalled();
  });

  it('stops everything playing at once', async () => {
    const first = sound.playSound('/clips/a.mp3');
    const second = sound.playSound('/clips/b.mp3');

    sound.stopAll();
    await Promise.all([first, second]);

    expect(children.map((child) => child.kill.mock.calls.length)).toEqual([1, 1]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still reports a player that fails on its own', async () => {
    const errors: unknown[] = [];
    sound.on('failure', (error) => errors.push(error));

    const playing = sound.playSound('/clips/broken.mp3');
    children[0]?.finish(1);
    await playing;

    expect(logger.error).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it('keeps its promise not to reject when nothing listens for failures', async () => {
    const playing = sound.playSound('/clips/broken.mp3');
    children[0]?.finish(1);

    await expect(playing).resolves.toBeUndefined();
  });
});
