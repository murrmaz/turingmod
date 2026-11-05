import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
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
const { spawn } = await import('node:child_process');

/** The command and arguments of the last process started. */
function lastSpawn(): [string | undefined, readonly string[] | undefined] {
  const call = vi.mocked(spawn).mock.calls.at(-1) as [string, readonly string[]] | undefined;
  return [call?.[0], call?.[1]];
}

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

    // Reported once; IntegrationManager logs what's reported, so it isn't logged here as well.
    expect(errors).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps its promise not to reject when nothing listens for failures', async () => {
    const playing = sound.playSound('/clips/broken.mp3');
    children[0]?.finish(1);

    await expect(playing).resolves.toBeUndefined();
  });

  it('reports a player that fails, without rejecting', async () => {
    const failures: Error[] = [];
    sound.on('failure', (error) => failures.push(error));

    const playing = sound.playSound('/clips/a.mp3');
    children[0]?.finish(1);
    await playing;

    expect(failures[0]?.message).toBe('Could not play /clips/a.mp3: afplay exited with code 1');
  });

  it('reports a player killed by something else', async () => {
    const failures: Error[] = [];
    sound.on('failure', (error) => failures.push(error));

    const playing = sound.playSound('/clips/a.mp3');
    children[0]?.emit('exit', null, 'SIGKILL');
    await playing;

    expect(failures[0]?.message).toBe(
      'Could not play /clips/a.mp3: afplay was killed by signal SIGKILL'
    );
  });

  it('reports a player that cannot run', async () => {
    const failures: Error[] = [];
    sound.on('failure', (error) => failures.push(error));

    const playing = sound.playSound('/clips/a.mp3');
    children[0]?.emit('error', new Error('spawn ENOENT'));
    await playing;

    expect(failures[0]?.message).toBe('Could not play /clips/a.mp3: spawn ENOENT');
  });

  it('scales the volume for macOS, whose player goes up to 2', async () => {
    const playing = sound.playSound('/clips/a.mp3', 0.25);
    children[0]?.finish();
    await playing;

    expect(lastSpawn()).toEqual(['afplay', ['-v', '0.5', '/clips/a.mp3']]);
  });

  it('passes a Windows path and volume as arguments, never in the script text', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const playing = sound.playSound('C:/clips/$(evil).mp3', 0.5);
    children[0]?.finish();
    await playing;

    const [command, args] = lastSpawn();
    expect(command).toBe('powershell');
    expect(args?.slice(-2)).toEqual(['C:/clips/$(evil).mp3', '0.5']);
    expect(args?.[3]).not.toContain('evil');
  });

  it('reports a platform it has no player for', async () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    const failures: Error[] = [];
    sound.on('failure', (error) => failures.push(error));

    await sound.playSound('/clips/a.mp3');

    expect(failures[0]?.message).toContain('not supported on platform "freebsd"');
  });

  it('is connected at once where the player needs no probing', async () => {
    await sound.start();

    expect(sound.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(children).toEqual([]);

    await sound.stop();
    expect(sound.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  describe('on Linux', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    /** Start, with only the player at this place in the probing order installed. */
    async function startWith(installedAt: number) {
      const started = sound.start();
      for (let probe = 0; probe <= installedAt; probe++) {
        await vi.waitFor(() => expect(children.length).toBe(probe + 1));
        const child = children[probe];
        if (probe === installedAt) {
          child?.finish();
        } else {
          child?.emit('error', new Error('spawn ENOENT'));
        }
      }
      await started;
      children.length = 0;
    }

    async function argsPlaying(volume: number) {
      const playing = sound.playSound('/clips/a.mp3', volume);
      children[0]?.finish();
      await playing;
      return lastSpawn();
    }

    it('is an error when no player is installed, naming what it tried', async () => {
      const started = sound.start();
      started.catch(() => {});
      for (let probe = 0; probe < 6; probe++) {
        await vi.waitFor(() => expect(children.length).toBe(probe + 1));
        children[probe]?.emit('error', new Error('spawn ENOENT'));
      }

      await expect(started).rejects.toThrow('No audio player found on PATH');
      expect(sound.getStatus()).toBe(IntegrationStatus.ERROR);
      expect(sound.getErrorMessage()).toContain('ffplay');
    });

    it('reports playing before a player was found', async () => {
      const failures: Error[] = [];
      sound.on('failure', (error) => failures.push(error));

      await sound.playSound('/clips/a.mp3');

      expect(failures[0]?.message).toContain('No audio player was resolved');
    });

    it('gives ffplay a volume out of 100', async () => {
      await startWith(0);

      expect(await argsPlaying(0.5)).toEqual([
        'ffplay',
        ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', '50', '/clips/a.mp3'],
      ]);
    });

    it('stops gst-play waiting for a key', async () => {
      await startWith(1);

      expect(await argsPlaying(0.5)).toEqual([
        'gst-play-1.0',
        ['--no-interactive', '/clips/a.mp3'],
      ]);
    });

    it('gives vlc its gain', async () => {
      await startWith(2);

      expect(await argsPlaying(0.5)).toEqual([
        'cvlc',
        ['--play-and-exit', '--gain', '0.5', '/clips/a.mp3'],
      ]);
    });

    it('leaves a player with no volume flag to the system mixer', async () => {
      await startWith(3);

      expect(await argsPlaying(0.5)).toEqual(['mpg123', ['/clips/a.mp3']]);
    });
  });
});
