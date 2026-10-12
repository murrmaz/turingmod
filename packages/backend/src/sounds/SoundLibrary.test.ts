import 'reflect-metadata';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import type { SoundIntegration } from '../integrations/implementations/sound/SoundIntegration.js';
import type { Logger } from '../utils/Logger.js';
import { SoundLibrary } from './SoundLibrary.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

describe('SoundLibrary', () => {
  let dir: string;
  let settings: unknown;
  let sound: {
    status: IntegrationStatus;
    getStatus: () => IntegrationStatus;
    playSound: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
  };
  let logger: ReturnType<typeof makeLogger>;
  let library: SoundLibrary;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sounds-'));
    await writeFile(join(dir, 'gunshot.mp3'), '');
    settings = { directory: dir, volume: 0.4 };
    sound = {
      status: IntegrationStatus.CONNECTED,
      getStatus: () => sound.status,
      playSound: vi.fn(() => Promise.resolve()),
      stopAll: vi.fn(),
    };
    logger = makeLogger();
    library = new SoundLibrary(
      sound as unknown as SoundIntegration,
      { getJson: () => Promise.resolve(settings) } as unknown as SettingsRepository,
      logger
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('plays a clip from the library directory at the configured volume', async () => {
    await library.play('gunshot.mp3', { maxDurationMs: 2000 });

    expect(sound.playSound).toHaveBeenCalledWith(join(dir, 'gunshot.mp3'), 0.4, 2000);
  });

  it('uses an absolute path as-is', async () => {
    expect(await library.resolve('/somewhere/else.wav')).toBe('/somewhere/else.wav');
  });

  it('defaults to the bundled data directory, where bonk.mp3 ships', async () => {
    settings = null;

    expect(await library.resolve('bonk.mp3')).toMatch(
      /packages[/\\]backend[/\\]data[/\\]bonk\.mp3$/
    );
    await library.play('bonk.mp3');
    expect(sound.playSound).toHaveBeenCalledWith(
      expect.stringMatching(/bonk\.mp3$/),
      0.5,
      undefined
    );
  });

  it('rejects a missing clip, so a sound-only reward is refunded', async () => {
    await expect(library.play('jumpscare_1.mp3')).rejects.toThrow('Sound clip not found');
    expect(sound.playSound).not.toHaveBeenCalled();
  });

  it('rejects while sound is not running', async () => {
    sound.status = IntegrationStatus.DISCONNECTED;

    await expect(library.play('gunshot.mp3')).rejects.toThrow('Sound is not running');
  });

  it('tryPlay logs instead of rejecting', async () => {
    await expect(library.tryPlay('jumpscare_1.mp3')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not play "jumpscare_1.mp3": Sound clip not found')
    );
  });

  it('stops everything playing', () => {
    library.stopAll();

    expect(sound.stopAll).toHaveBeenCalled();
  });
});
