import 'reflect-metadata';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { ServiceErrorEvent } from '../../core/events.js';
import type {
  SettingsDefinition,
  SettingsRepository,
} from '../../database/repositories/SettingsRepository.js';
import type { SoundIntegration } from '../../integrations/implementations/sound/SoundIntegration.js';
import { fake, silentLogger } from '../../testing.js';
import { Logger } from '../../utils/Logger.js';
import { SoundLibrary } from './SoundLibrary.js';

describe('SoundLibrary', () => {
  let dir: string;
  let settings: unknown;
  let sound: {
    status: IntegrationStatus;
    getStatus: () => IntegrationStatus;
    playSound: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
  };
  let logger: ReturnType<typeof silentLogger>;
  let errors: ReturnType<typeof vi.fn<(event: ServiceErrorEvent) => void>>;
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
    logger = silentLogger();
    const eventBus = new EventBus(new Logger({ level: 'silent' }));
    errors = vi.fn<(event: ServiceErrorEvent) => void>();
    eventBus.on('service.error', errors);
    library = new SoundLibrary(
      fake<SoundIntegration>()(sound),
      fake<SettingsRepository>()({
        get: <T>(definition: SettingsDefinition<T>) => definition.schema.parse(settings ?? {}),
      }),
      eventBus,
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

  it('uses an absolute path as-is', () => {
    expect(library.resolve('/somewhere/else.wav')).toBe('/somewhere/else.wav');
  });

  it('defaults to the bundled data directory, where bonk.mp3 ships', async () => {
    settings = null;

    expect(library.resolve('bonk.mp3')).toMatch(/packages[/\\]backend[/\\]data[/\\]bonk\.mp3$/);
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

  describe('tryPlay', () => {
    it('reports a missing clip instead of rejecting', async () => {
      await expect(library.tryPlay('jumpscare_1.mp3')).resolves.toBeUndefined();

      expect(errors).toHaveBeenCalledExactlyOnceWith({
        service: 'Sounds',
        message: expect.stringMatching(/Could not play the sound "jumpscare_1.mp3".*not found/),
      });
    });

    it('reports a clip once until it plays again', async () => {
      await library.tryPlay('jumpscare_1.mp3');
      await library.tryPlay('jumpscare_1.mp3');
      expect(errors).toHaveBeenCalledOnce();

      await writeFile(join(dir, 'jumpscare_1.mp3'), '');
      await library.tryPlay('jumpscare_1.mp3');
      await rm(join(dir, 'jumpscare_1.mp3'));
      await library.tryPlay('jumpscare_1.mp3');

      expect(errors).toHaveBeenCalledTimes(2);
    });

    it('says nothing while sound is not running, which its status already shows', async () => {
      sound.status = IntegrationStatus.DISCONNECTED;

      await library.tryPlay('jumpscare_1.mp3');

      expect(errors).not.toHaveBeenCalled();
      expect(sound.playSound).not.toHaveBeenCalled();
    });
  });

  it('stops everything playing', () => {
    library.stopAll();

    expect(sound.stopAll).toHaveBeenCalled();
  });
});
