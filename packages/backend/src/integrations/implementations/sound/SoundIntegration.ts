import { type ChildProcess, spawn } from 'node:child_process';
import { IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';

/** Linux players to probe for at startup, ordered by format coverage (MP3 + WAV first). */
const LINUX_PLAYER_CANDIDATES = ['ffplay', 'gst-play-1.0', 'cvlc', 'mpg123', 'paplay', 'aplay'];

/**
 * PowerShell script executed via `-Command` with the file path and volume passed as
 * positional args, so paths never get interpolated directly into the script text.
 */
const WINDOWS_PLAY_SCRIPT = `
param([string]$Path, [double]$Volume)
Add-Type -AssemblyName presentationCore
$player = New-Object system.windows.media.mediaplayer
$player.open([Uri]$Path)
$player.Volume = $Volume
$player.Play()
Start-Sleep 1
Start-Sleep -s $player.NaturalDuration.TimeSpan.TotalSeconds
Exit
`;

@injectable()
@singleton()
export class SoundIntegration extends BaseIntegration {
  readonly name = 'sound';

  private linuxPlayerCommand: string | undefined;
  /** Player processes still running. */
  private playing = new Set<ChildProcess>();
  /** Players killed on purpose, whose exit is a normal end rather than a failure. */
  private cutShort = new WeakSet<ChildProcess>();

  constructor(logger: Logger) {
    super(logger, { component: 'SoundIntegration' });
  }

  initialize(_config: Record<string, unknown>): Promise<void> {
    this.logger.info('Sound integration initialized');
    return Promise.resolve();
  }

  async start(): Promise<void> {
    if (process.platform === 'linux') {
      this.linuxPlayerCommand = await this.resolveLinuxPlayer();
      if (!this.linuxPlayerCommand) {
        const errorMessage = `No audio player found on PATH (tried: ${LINUX_PLAYER_CANDIDATES.join(', ')}). Install one of these to enable sound playback.`;
        this.logger.error(errorMessage);
        this.setStatus(IntegrationStatus.ERROR, errorMessage);
        throw new Error(errorMessage);
      }
      this.logger.debug('Resolved Linux audio player', { command: this.linuxPlayerCommand });
    }

    this.setStatus(IntegrationStatus.CONNECTED);
    this.logger.debug('Sound integration started');
  }

  stop(): Promise<void> {
    this.stopAll();

    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.debug('Sound integration stopped');
    return Promise.resolve();
  }

  /**
   * Play a file and resolve when it ends. Never rejects; failures are logged.
   * @param maxDurationMs Cut the sound off after this long.
   */
  async playSound(filePath: string, volume = 0.5, maxDurationMs?: number): Promise<void> {
    this.logger.info('Playing sound', { filePath, volume });

    try {
      await this.runPlatformPlayer(filePath, volume, maxDurationMs);
      this.logger.debug('Sound playback completed', { filePath });
    } catch (error) {
      this.logger.error('Sound playback failed', error, { filePath });
      this.reportFailure(error);
    }
  }

  /** Cut off every sound that is playing. */
  stopAll(): void {
    for (const child of this.playing) {
      this.cutShort.add(child);
      child.kill();
    }
  }

  private async runPlatformPlayer(
    filePath: string,
    volume: number,
    maxDurationMs: number | undefined
  ): Promise<void> {
    switch (process.platform) {
      case 'darwin': {
        // afplay volume is 0-2 (default 1); scale our 0-1 range accordingly.
        const scaledVolume = Math.min(2, volume * 2);
        await this.run('afplay', ['-v', String(scaledVolume), filePath], maxDurationMs);
        return;
      }
      case 'win32': {
        await this.run(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            WINDOWS_PLAY_SCRIPT,
            filePath,
            String(volume),
          ],
          maxDurationMs
        );
        return;
      }
      case 'linux': {
        if (!this.linuxPlayerCommand) {
          throw new Error('No audio player was resolved at startup; cannot play sound.');
        }
        await this.run(
          this.linuxPlayerCommand,
          this.buildLinuxPlayerArgs(this.linuxPlayerCommand, filePath, volume),
          maxDurationMs
        );
        return;
      }
      default:
        throw new Error(`Sound playback is not supported on platform "${process.platform}"`);
    }
  }

  private buildLinuxPlayerArgs(command: string, filePath: string, volume: number): string[] {
    switch (command) {
      case 'ffplay':
        // volume is 0-100 for ffplay.
        return [
          '-nodisp',
          '-autoexit',
          '-loglevel',
          'quiet',
          '-volume',
          String(Math.round(volume * 100)),
          filePath,
        ];
      case 'cvlc':
        // --gain is roughly 0-1+.
        return ['--play-and-exit', '--gain', String(volume), filePath];
      case 'gst-play-1.0':
        return ['--no-interactive', filePath];
      default:
        // mpg123, paplay, aplay: no reliable volume flag across all of these,
        // so play at whatever the system mixer is set to.
        return [filePath];
    }
  }

  private async resolveLinuxPlayer(): Promise<string | undefined> {
    for (const command of LINUX_PLAYER_CANDIDATES) {
      if (await this.commandExists(command)) {
        return command;
      }
    }
    return undefined;
  }

  private commandExists(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = spawn(command, ['--version']);
      probe.on('error', () => resolve(false));
      probe.on('exit', () => resolve(true));
    });
  }

  private run(command: string, args: string[], maxDurationMs?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      this.playing.add(child);
      const timer =
        maxDurationMs === undefined
          ? undefined
          : setTimeout(() => {
              this.cutShort.add(child);
              child.kill();
            }, maxDurationMs);
      const finished = () => {
        clearTimeout(timer);
        this.playing.delete(child);
      };

      child.on('error', (error) => {
        finished();
        reject(error);
      });
      child.on('exit', (code, signal) => {
        finished();
        if (this.cutShort.has(child)) {
          resolve();
        } else if (signal) {
          reject(new Error(`${command} was killed by signal ${signal}`));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}`));
        }
      });
    });
  }
}
