import { IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import type { IService } from '../core/ServiceLifecycle.js';
import { SettingsRepository } from '../database/repositories/SettingsRepository.js';
import {
  ObsIntegration,
  type SceneItemTransform,
} from '../integrations/implementations/obs/ObsIntegration.js';
import { listScenesByCanvas } from '../integrations/implementations/obs/scenesByCanvas.js';
import { Logger } from '../utils/Logger.js';
import { EFFECT_SETTINGS_KEY, parseEffectSettings } from './effectSettings.js';
import type { EffectContext, FacecamEffect, FacecamTarget } from './FacecamEffect.js';
import { restorableTransform } from './transformMath.js';

/**
 * Plays facecam effects one at a time and always puts the facecam back.
 *
 * Effects queue rather than overlap: two effects transforming the same source at once would
 * each restore the other's mid-animation state as the "original". Each effect starts from a
 * fresh read of the facecam's transform, which is restored when the effect ends — normally, by
 * throwing, or by `stop()` — and any filter it added is removed.
 *
 * The facecam is found by source name in the program scene on the main canvas and, on every
 * other canvas (e.g. Aitum Vertical), in the first scene that contains it. obs-websocket can't
 * report another canvas's live scene, which is why that is a guess, and the same one the
 * original bot made.
 */
@injectable()
@singleton()
export class FacecamEffectRunner implements IService {
  private queue: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  private logger: Logger;

  constructor(
    private obs: ObsIntegration,
    private settingsRepo: SettingsRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'FacecamEffectRunner' });
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
    this.abort.abort();
    await this.queue;
  }

  private async play(effect: FacecamEffect): Promise<void> {
    const { signal } = this.abort;
    if (signal.aborted) {
      throw new Error('Facecam effects are stopped');
    }
    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      throw new Error('OBS is not connected');
    }

    const { facecamSource } = parseEffectSettings(
      await this.settingsRepo.getJson(EFFECT_SETTINGS_KEY)
    );
    const targets = await this.findFacecam(facecamSource, effect.mainCanvasOnly === true);
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
      await this.restore(facecamSource, targets, filters);
    }
  }

  private async restore(
    source: string,
    targets: readonly FacecamTarget[],
    filters: Set<string>
  ): Promise<void> {
    for (const target of targets) {
      try {
        await this.obs.setSceneItemTransform(
          target.sceneUuid,
          target.sceneItemId,
          restorableTransform(target.original)
        );
      } catch (error) {
        this.logger.error(
          `Could not restore "${source}" after an effect; check its position in OBS`,
          error
        );
      }
    }
    for (const filter of filters) {
      try {
        await this.obs.removeFilter(source, filter);
      } catch (error) {
        this.logger.error(`Could not remove filter "${filter}" from "${source}"`, error);
      }
    }
  }

  private async findFacecam(source: string, mainOnly: boolean): Promise<FacecamTarget[]> {
    const programUuid = await this.obs.getCurrentSceneUuid();

    // [scene uuids to search, is main canvas], main canvas first. The main canvas is the one
    // holding the program scene; it's searched through that scene alone.
    const candidates: [string[], boolean][] = [[[programUuid], true]];
    if (!mainOnly) {
      for (const { scenes } of await listScenesByCanvas(this.obs)) {
        const sceneUuids = scenes.map((s) => s.sceneUuid);
        if (!sceneUuids.includes(programUuid)) {
          candidates.push([sceneUuids, false]);
        }
      }
    }

    const targets: FacecamTarget[] = [];
    for (const [sceneUuids, isMain] of candidates) {
      for (const sceneUuid of sceneUuids) {
        const item = (await this.obs.getSceneItems(sceneUuid)).find((i) => i.sourceName === source);
        if (!item) continue;
        const original: SceneItemTransform = await this.obs.getSceneItemTransform(
          sceneUuid,
          item.sceneItemId
        );
        targets.push({ sceneUuid, sceneItemId: item.sceneItemId, isMain, original });
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
