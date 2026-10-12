import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import { StreamControlService } from '../platforms/StreamControlService.js';
import { SoundLibrary } from '../sounds/SoundLibrary.js';
import { formatCountdown } from '../utils/FormatHelpers.js';
import { Logger } from '../utils/Logger.js';
import {
  BREAK_SETTINGS_KEY,
  type BreakSettings,
  DEFAULT_BREAK_SETTINGS,
  type PerPlatformMessage,
  parseBreakSettings,
  renderMessage,
} from './breakSettings.js';
import { ObsBreakOverlay, type ObsBreakSnapshot } from './ObsBreakOverlay.js';

/** What started a break. Ad breaks come from Twitch; manual ones from `!break`. */
export type BreakReason = 'ad' | 'manual';

/** Payload of `stream.break.started` and `stream.break.ended`. */
export interface StreamBreakEvent {
  reason: BreakReason;
  /** Planned length at start; actual length at end. */
  durationSeconds: number;
}

/** Shape of the `twitch.ad.break` EventBus event (see TwitchEventSubIntegration). */
interface TwitchAdBreakEvent {
  durationSeconds: number;
}

interface ActiveBreak {
  reason: BreakReason;
  startedAt: number;
  endsAt: number;
  timer: NodeJS.Timeout;
  /** Pending until the overlay is applied; restore waits on it so it can't run first. */
  snapshot: Promise<ObsBreakSnapshot>;
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
 */
@injectable()
@singleton()
export class BreakService {
  private settings: BreakSettings = DEFAULT_BREAK_SETTINGS;
  private active: ActiveBreak | null = null;
  private unsubscribers: (() => void)[] = [];
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private settingsRepo: SettingsRepository,
    private overlay: ObsBreakOverlay,
    private streamControl: StreamControlService,
    private sounds: SoundLibrary,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'BreakService' });
  }

  async start(): Promise<void> {
    await this.reloadSettings();

    this.unsubscribers.push(
      this.eventBus.on<TwitchAdBreakEvent>('twitch.ad.break', async (event) => {
        if (!this.settings.enabled) {
          this.logger.info('Twitch ad break started; automatic breaks are disabled');
          return;
        }
        await this.startBreak('ad', event.durationSeconds);
      })
    );
  }

  /** End any running break (restoring OBS) and stop listening. Call before OBS disconnects. */
  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    await this.endBreak({ announce: false });
  }

  /** Re-read settings from the database, keeping valid fields and defaulting the rest. */
  async reloadSettings(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this.settingsRepo.getJson(BREAK_SETTINGS_KEY);
    } catch (error) {
      this.logger.error('Could not read break settings; using defaults', error);
    }
    const { settings, problems } = parseBreakSettings(raw);
    for (const problem of problems) {
      this.logger.warn(problem);
    }
    this.settings = settings;
  }

  getSettings(): BreakSettings {
    return this.settings;
  }

  /** When the current break ends (epoch ms), or null if not on a break. */
  getBreakEndsAt(): number | null {
    return this.active?.endsAt ?? null;
  }

  /**
   * Start a break, or extend the running one so it lasts at least `durationSeconds` from now.
   * Resolves once the break is in effect (OBS applied, chat told).
   */
  async startBreak(
    reason: BreakReason,
    durationSeconds: number
  ): Promise<{ extended: boolean; endsAt: number }> {
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
    const snapshot = this.overlay.apply(this.settings.obs);
    this.active = {
      reason,
      startedAt: Date.now(),
      endsAt,
      timer: this.scheduleEnd(endsAt),
      snapshot,
    };
    this.logger.info('Break started', { reason, durationSeconds: durationMs / 1000 });

    this.playSound(this.settings.sounds.breakStarted);
    const startedMessage =
      reason === 'ad'
        ? this.settings.messages.adBreakStarted
        : this.settings.messages.manualBreakStarted;
    await Promise.all([
      snapshot,
      this.announce(startedMessage, { duration: formatCountdown(durationMs) }),
    ]);
    await this.eventBus.emit<StreamBreakEvent>('stream.break.started', {
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

    await this.overlay.restore(await active.snapshot);
    this.playSound(this.settings.sounds.breakEnded);
    if (options.announce !== false) {
      await this.announce(this.settings.messages.breakEnded, {});
    }

    const durationSeconds = Math.round((Date.now() - active.startedAt) / 1000);
    this.logger.info('Break ended', { reason: active.reason, durationSeconds });
    await this.eventBus.emit<StreamBreakEvent>('stream.break.ended', {
      reason: active.reason,
      durationSeconds,
    });
    return true;
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
      const result = await this.streamControl.announce((platform) =>
        renderMessage(message, platform, vars)
      );
      for (const failure of result.failures) {
        this.logger.warn(`Could not post break message to ${failure.platform}`, {
          error: failure.error,
        });
      }
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
