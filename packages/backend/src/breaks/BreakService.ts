import { IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import type { BreakReason } from '../core/events.js';
import {
  failureReporter,
  type IService,
  type ReportFailure,
  Subscriptions,
} from '../core/ServiceLifecycle.js';
import { ObsBreakRestoreRepository } from '../database/repositories/ObsBreakRestoreRepository.js';
import { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import { ObsIntegration } from '../integrations/implementations/obs/ObsIntegration.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { SoundLibrary } from '../sounds/SoundLibrary.js';
import { formatCountdown } from '../utils/FormatHelpers.js';
import { Logger } from '../utils/Logger.js';
import {
  BREAK_SETTINGS,
  type BreakSettings,
  DEFAULT_BREAK_SETTINGS,
  type PerPlatformMessage,
  renderMessage,
} from './breakSettings.js';
import { isEmptySnapshot, ObsBreakOverlay, type ObsBreakSnapshot } from './ObsBreakOverlay.js';

interface ActiveBreak {
  reason: BreakReason;
  startedAt: number;
  endsAt: number;
  timer: NodeJS.Timeout;
}

/** Longest break `startBreak` accepts; Twitch's longest ad break is 3 minutes. */
export const MAX_BREAK_SECONDS = 60 * 60;

/**
 * Takes the streamer off camera and mic for a break, on every platform at once since it's one
 * OBS output, and tells each platform's chat.
 *
 * Breaks start automatically when Twitch starts an ad break (`twitch.ad.break`) and manually via
 * `!break`. A break that starts while one is already running extends it rather than stacking,
 * so the OBS snapshot is only ever taken from the pre-break state.
 *
 * Every side effect is best-effort and independent: OBS being down still lets chat hear about
 * the break, and a chat failure never leaves OBS in break state.
 *
 * What a break changed in OBS is stored until it has been put back (`ObsBreakRestoreRepository`),
 * and whenever OBS connects, OBS is brought in line: the overlay applied if a break is running,
 * the stored state restored if not. So a break that ends while OBS is down is undone when OBS
 * returns, and one interrupted by TuringMod crashing is undone the next time it starts. A break
 * itself doesn't survive a restart: its timer and chat messages died with the process.
 *
 * The streamer is told when a break leaves them on air or doesn't fully put things back. What OBS
 * refuses while connected won't go better later, so it's reported once and not retried.
 */
@singleton()
export class BreakService implements IService {
  private settings: BreakSettings = DEFAULT_BREAK_SETTINGS;
  private active: ActiveBreak | null = null;
  /** What breaks changed in OBS and haven't put back yet; mirrors the stored copy. */
  private owed: ObsBreakSnapshot | null = null;
  /** OBS changes run one at a time, in order, so a restore can't overtake the apply before it. */
  private obsWork: Promise<void> = Promise.resolve();
  private subscriptions = new Subscriptions();
  /** Set by `stop()`; a break can't start after it, or it would outlive OBS's connection. */
  private stopped = false;
  private logger: Logger;
  private report: ReportFailure;

  constructor(
    private eventBus: EventBus,
    private settingsRepo: SettingsRepository,
    private overlay: ObsBreakOverlay,
    private restoreRepo: ObsBreakRestoreRepository,
    private obs: ObsIntegration,
    private streamControl: StreamControlService,
    private sounds: SoundLibrary,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'BreakService' });
    this.report = failureReporter(eventBus, this.logger, 'Breaks');
  }

  start(): void {
    this.reloadSettings();
    this.owed = this.loadOwed();

    this.subscriptions.add(
      this.eventBus.on('twitch.ad.break', async (event) => {
        if (!this.settings.enabled) {
          this.logger.info('Twitch ad break started; automatic breaks are disabled');
          return;
        }
        await this.startBreak('ad', event.durationSeconds);
      }),
      this.eventBus.on('integration.status', ({ name, status }) => {
        if (name === this.obs.name && status === IntegrationStatus.CONNECTED) {
          return this.syncObs();
        }
      })
    );
    if (this.obs.getStatus() === IntegrationStatus.CONNECTED) {
      void this.syncObs();
    }
  }

  /**
   * End any running break (restoring OBS), stop listening, and refuse new breaks. Call before OBS
   * disconnects.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.subscriptions.clear();
    await this.endBreak({ announce: false });
    await this.obsWork;
  }

  /** Re-read settings from the database. Throws if the stored settings aren't valid. */
  reloadSettings(): void {
    this.settings = this.settingsRepo.get(BREAK_SETTINGS);
  }

  getSettings(): BreakSettings {
    return this.settings;
  }

  /**
   * Start a break, or extend the running one so it lasts at least `durationSeconds` from now.
   * Resolves once the break is in effect (OBS applied, chat told).
   */
  async startBreak(
    reason: BreakReason,
    durationSeconds: number
  ): Promise<{ extended: boolean; endsAt: number }> {
    if (this.stopped) {
      throw new Error('Breaks are stopped: TuringMod is shutting down');
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`Invalid break duration: ${durationSeconds}`);
    }
    const durationMs = Math.min(durationSeconds, MAX_BREAK_SECONDS) * 1000;
    const endsAt = Date.now() + durationMs;

    if (this.active) {
      if (endsAt > this.active.endsAt) {
        clearTimeout(this.active.timer);
        this.active.endsAt = endsAt;
        this.active.timer = this.scheduleEnd(endsAt);
      }
      this.logger.info('Break already running; extended', {
        reason,
        endsAt: new Date(this.active.endsAt).toISOString(),
      });
      return { extended: true, endsAt: this.active.endsAt };
    }

    // Claim the break synchronously, before any await, so a second trigger arriving while OBS
    // is being updated sees it and extends instead of snapshotting the half-applied state.
    const applied = this.queueObs(() => this.applyOverlay());
    this.active = {
      reason,
      startedAt: Date.now(),
      endsAt,
      timer: this.scheduleEnd(endsAt),
    };
    this.logger.info('Break started', { reason, durationSeconds: durationMs / 1000 });

    this.playSound(this.settings.sounds.breakStarted);
    const startedMessage =
      reason === 'ad'
        ? this.settings.messages.adBreakStarted
        : this.settings.messages.manualBreakStarted;
    await Promise.all([
      applied,
      this.announce(startedMessage, { duration: formatCountdown(durationMs) }),
    ]);
    await this.eventBus.emit('stream.break.started', {
      reason,
      durationSeconds: durationMs / 1000,
    });

    return { extended: false, endsAt };
  }

  /**
   * End the running break now, restoring OBS. Resolves to false if there was no break.
   * @param options.announce Tell chat the break is over (default true).
   */
  async endBreak(options: { announce?: boolean } = {}): Promise<boolean> {
    const active = this.active;
    if (!active) {
      return false;
    }
    // Release the break before awaiting, so a trigger arriving during the restore starts a
    // fresh break (with a fresh snapshot) rather than extending one that's being torn down.
    this.active = null;
    clearTimeout(active.timer);

    await this.queueObs(() => this.restoreOverlay());
    this.playSound(this.settings.sounds.breakEnded);
    if (options.announce !== false) {
      await this.announce(this.settings.messages.breakEnded, {});
    }

    const durationSeconds = Math.round((Date.now() - active.startedAt) / 1000);
    this.logger.info('Break ended', { reason: active.reason, durationSeconds });
    await this.eventBus.emit('stream.break.ended', {
      reason: active.reason,
      durationSeconds,
    });
    return true;
  }

  /** Bring OBS in line with whether a break is running, now that it has connected. */
  private syncObs(): Promise<void> {
    return this.queueObs(() => (this.active ? this.applyOverlay() : this.restoreOverlay()));
  }

  /** Run `work` after the OBS changes queued before it. Resolves when it's done; never rejects. */
  private queueObs(work: () => Promise<void>): Promise<void> {
    this.obsWork = this.obsWork.then(work).catch((error: unknown) => {
      this.report('Failed to update OBS for a break; check the facecam and mic in OBS.', error);
    });
    return this.obsWork;
  }

  /** Apply the overlay, adding what it changes to what is already owed. */
  private async applyOverlay(): Promise<void> {
    const { snapshot, connected, failed } = await this.overlay.apply(
      this.settings.obs,
      this.owed ?? undefined
    );
    this.setOwed(snapshot);
    if (!connected) {
      this.report(
        "OBS isn't connected, so this break hasn't taken you off camera and mic. It will if OBS " +
          'connects during the break.'
      );
    } else if (failed.length > 0) {
      this.report(
        `OBS didn't finish starting this break, so viewers may still see or hear you. Could not ` +
          `${failed.join('; ')}. Check the facecam and mic in OBS.`
      );
    }
  }

  /** Put back what breaks changed, and forget it once that has reached OBS. */
  private async restoreOverlay(): Promise<void> {
    if (!this.owed) {
      return;
    }
    const { connected, failed } = await this.overlay.restore(this.owed);
    if (!connected) {
      return;
    }
    this.setOwed(null);
    if (failed.length > 0) {
      this.report(
        `OBS didn't put everything back after the break. Could not ${failed.join('; ')}. Check ` +
          'the facecam and mic in OBS.'
      );
    }
  }

  private setOwed(snapshot: ObsBreakSnapshot | null): void {
    this.owed = snapshot && !isEmptySnapshot(snapshot) ? snapshot : null;
    try {
      if (this.owed) {
        this.restoreRepo.save(this.owed);
      } else {
        this.restoreRepo.clear();
      }
    } catch (error) {
      // Still restored from memory; only a restart before then would lose it.
      this.report(
        'Could not store the OBS state to restore after the break. If TuringMod restarts before ' +
          'then, check the facecam and mic in OBS.',
        error
      );
    }
  }

  /**
   * What an earlier run left to restore, if anything. Unreadable state doesn't stop startup: it's
   * dropped, and the streamer told, since OBS may still be showing the break.
   */
  private loadOwed(): ObsBreakSnapshot | null {
    try {
      const owed = this.restoreRepo.get();
      if (owed) {
        this.logger.warn(
          'A break left OBS changed when TuringMod last stopped; restoring when OBS connects'
        );
      }
      return owed;
    } catch (error) {
      this.report(
        'The OBS state to restore after a break could not be read and was dropped; check the ' +
          'facecam and mic in OBS.',
        error
      );
      this.setOwed(null);
      return null;
    }
  }

  private scheduleEnd(endsAt: number): NodeJS.Timeout {
    return setTimeout(
      () => {
        void this.endBreak().catch((error: unknown) => {
          this.logger.error('Failed to end break', error);
        });
      },
      Math.max(0, endsAt - Date.now())
    );
  }

  private async announce(message: PerPlatformMessage, vars: Record<string, string>): Promise<void> {
    try {
      await this.streamControl.announce((platform) => renderMessage(message, platform, vars));
    } catch (error) {
      this.logger.error('Could not post break message', error);
    }
  }

  private playSound(clip: string | null): void {
    if (clip) {
      void this.sounds.tryPlay(clip);
    }
  }
}
