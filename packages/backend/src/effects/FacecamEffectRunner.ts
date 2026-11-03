import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import {
  ObsIntegration,
  type SceneItemTransform,
} from '../integrations/implementations/obs/ObsIntegration.js';
import {
  listPlacements,
  listScenesByCanvas,
  warnSkipped,
} from '../integrations/implementations/obs/sceneGraph.js';
import { Logger } from '../utils/Logger.js';
import { EFFECT_SETTINGS } from './effectSettings.js';
import type { EffectContext, FacecamEffect, FacecamTarget } from './FacecamEffect.js';
import { restorableTransform } from './transformMath.js';

/** What an effect changed on a source, to be put back. */
interface FacecamRestore {
  source: string;
  targets: FacecamTarget[];
  filters: string[];
}

/**
 * Plays facecam effects one at a time and always puts the facecam back.
 *
 * Effects queue rather than overlap: two effects transforming the same source at once would
 * each restore the other's mid-animation state as the "original". Each effect starts from a
 * fresh read of the facecam's transform, which is restored when the effect ends — normally, by
 * throwing, or by `stop()` — and any filter it added is removed. What couldn't be put back because
 * OBS had gone is put back when OBS connects again, before any later effect reads the transform as
 * its "original"; what OBS itself refused is reported to the streamer. Nothing here is stored, so a
 * restart while OBS is down loses it, and that is reported too when it's a clean stop.
 *
 * The facecam is found by source name, placed directly or inside a group, in the program scene on
 * the main canvas and, on every other canvas (e.g. Aitum Vertical), in the first scene that
 * contains it. obs-websocket can't
 * report another canvas's live scene, which is why that is a guess, and the same one the
 * original bot made.
 */
@singleton()
export class FacecamEffectRunner implements IService {
  private queue: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  /** What couldn't be put back because OBS was gone. */
  private owed: FacecamRestore[] = [];
  private subscriptions = new Subscriptions();
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private obs: ObsIntegration,
    private settingsRepo: SettingsRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'FacecamEffectRunner' });
  }

  start(): void {
    this.subscriptions.add(
      this.eventBus.on('integration.status', ({ name, status }) => {
        if (name === this.obs.name && status === IntegrationStatus.CONNECTED) {
          return this.restoreOwed();
        }
      })
    );
  }

  /**
   * Queue an effect and resolve when it has played and the facecam is restored. Rejects if it
   * couldn't play (OBS down, no facecam) or failed partway, so a reward can be refunded.
   */
  run(effect: FacecamEffect): Promise<void> {
    const result = this.queue.then(() => this.play(effect));
    // The queue only orders effects; one effect's failure is its caller's, not the next one's.
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Cut the running effect short (restoring the facecam) and refuse queued ones. */
  async stop(): Promise<void> {
    this.subscriptions.clear();
    this.abort.abort();
    await this.queue;
    if (this.owed.length > 0) {
      this.report(
        `TuringMod stopped before OBS came back, so "${this.owed[0]?.source}" was not put back ` +
          'after an effect; check its position and filters in OBS.'
      );
    }
  }

  /** Put back what an outage left behind. Queued, so it runs before any effect asked for after. */
  private restoreOwed(): Promise<void> {
    this.queue = this.queue.then(async () => {
      for (const owed of this.owed.splice(0)) {
        await this.restore(owed);
      }
    });
    return this.queue;
  }

  private async play(effect: FacecamEffect): Promise<void> {
    const { signal } = this.abort;
    if (signal.aborted) {
      throw new Error('Facecam effects are stopped');
    }
    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      throw new Error('OBS is not connected');
    }

    const { facecamSource } = this.settingsRepo.get(EFFECT_SETTINGS);
    const targets = await this.findFacecam(facecamSource, effect);
    if (targets.length === 0) {
      throw new Error(`No "${facecamSource}" source in the current scene`);
    }

    const filters = new Set<string>();
    const context: EffectContext = {
      targets,
      signal,
      setTransform: (target, transform) =>
        this.obs.setSceneItemTransform(target.sceneUuid, target.sceneItemId, transform),
      canvasSize: () => this.obs.getCanvasSize(),
      addFilter: async (name, kind, settings) => {
        filters.add(name);
        await this.obs.addFilter(facecamSource, name, kind, settings);
      },
      setFilterSettings: (name, settings) =>
        this.obs.setFilterSettings(facecamSource, name, settings),
      sleep: (ms) => abortableSleep(ms, signal),
      now: () => Date.now(),
    };

    this.logger.info(`Playing facecam effect "${effect.name}"`, { scenes: targets.length });
    try {
      await effect.run(context);
    } finally {
      await this.restore({ source: facecamSource, targets, filters: [...filters] });
    }
  }

  /**
   * Put back what an effect changed, as far as OBS lets it. Never rejects. Whatever fails while OBS
   * is gone is kept for when it returns; whatever OBS refuses won't go better next time, so it's
   * reported instead of blocking later effects.
   */
  private async restore({ source, targets, filters }: FacecamRestore): Promise<void> {
    const failed: FacecamRestore = { source, targets: [], filters: [] };
    let lastError: unknown;
    for (const target of targets) {
      try {
        await this.obs.setSceneItemTransform(
          target.sceneUuid,
          target.sceneItemId,
          restorableTransform(target.original)
        );
      } catch (error) {
        failed.targets.push(target);
        lastError = error;
      }
    }
    for (const filter of filters) {
      try {
        await this.obs.removeFilter(source, filter);
      } catch (error) {
        failed.filters.push(filter);
        lastError = error;
      }
    }
    if (failed.targets.length === 0 && failed.filters.length === 0) {
      return;
    }

    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.owed.push(failed);
      this.logger.warn(`OBS is gone; restoring "${source}" when it reconnects`);
      return;
    }
    this.logger.error(`Could not restore "${source}" after an effect`, lastError);
    this.report(
      `Could not put "${source}" back after an effect; check its position and filters in OBS. ` +
        messageOf(lastError)
    );
  }

  private report(message: string): void {
    this.eventBus.emitSync('service.error', { service: 'Facecam effects', message });
  }

  private async findFacecam(source: string, effect: FacecamEffect): Promise<FacecamTarget[]> {
    const onSkipped = warnSkipped(this.logger);
    const programUuid = await this.obs.getCurrentSceneUuid();

    // [scene uuids to search, is main canvas], main canvas first. The main canvas is the one
    // holding the program scene; it's searched through that scene alone.
    const candidates: [string[], boolean][] = [[[programUuid], true]];
    if (effect.usesCanvasSize !== true) {
      for (const { scenes } of await listScenesByCanvas(this.obs, onSkipped)) {
        const sceneUuids = scenes.map((s) => s.sceneUuid);
        if (!sceneUuids.includes(programUuid)) {
          candidates.push([sceneUuids, false]);
        }
      }
    }

    const targets: FacecamTarget[] = [];
    for (const [sceneUuids, isMain] of candidates) {
      for (const sceneUuid of sceneUuids) {
        const placement = (await listPlacements(this.obs, sceneUuid, onSkipped)).find(
          (p) => p.item.sourceName === source
        );
        if (!placement) continue;
        if (placement.inGroup && effect.usesCanvasSize === true) {
          throw new Error(
            `"${source}" is inside a group, so "${effect.name}" can't move it around the canvas`
          );
        }
        const { containerUuid, item } = placement;
        const original: SceneItemTransform = await this.obs.getSceneItemTransform(
          containerUuid,
          item.sceneItemId
        );
        targets.push({ sceneUuid: containerUuid, sceneItemId: item.sceneItemId, isMain, original });
        break;
      }
    }
    return targets;
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
