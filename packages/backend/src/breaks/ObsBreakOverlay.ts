import { IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import {
  ObsIntegration,
  type ObsScene,
} from '../integrations/implementations/obs/ObsIntegration.js';
import { listScenesByCanvas } from '../integrations/implementations/obs/scenesByCanvas.js';
import { Logger } from '../utils/Logger.js';
import type { BreakSettings } from './breakSettings.js';

/** What the overlay changed, recorded before changing it, so restore() can put it back exactly. */
export interface ObsBreakSnapshot {
  /** Original visibility of every scene item the overlay touched, keyed by `sceneUuid:itemId`. */
  items: Map<string, { sceneUuid: string; sceneItemId: number; enabled: boolean }>;
  /** Original mute state of every input the overlay touched. */
  inputs: Map<string, boolean>;
}

/**
 * Puts OBS into "break" state and back: hides the configured sources (facecam), shows the break
 * sources ("Ads Text") and mutes the configured inputs (mic).
 *
 * Every scene on every canvas is covered, not just the program scene: a non-main canvas such as
 * Aitum Vertical has no program scene obs-websocket can report, and covering all scenes also
 * means a scene switch mid-break doesn't put the streamer back on camera.
 *
 * Both directions set absolute states from a snapshot rather than toggling, so a mic that was
 * already muted stays muted afterwards, and a partial failure can't leave things inverted. Each
 * change is attempted independently: one missing source doesn't stop the rest.
 */
@injectable()
@singleton()
export class ObsBreakOverlay {
  private logger: Logger;

  constructor(
    private obs: ObsIntegration,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ObsBreakOverlay' });
  }

  /** Apply the break state and return what it changed. Never throws; failures are logged. */
  async apply(settings: BreakSettings['obs']): Promise<ObsBreakSnapshot> {
    const snapshot: ObsBreakSnapshot = { items: new Map(), inputs: new Map() };

    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.warn('OBS is not connected; skipping the break overlay');
      return snapshot;
    }

    for (const scene of await this.allScenes(settings.keepVisibleInScenes)) {
      await this.applyToScene(scene.uuid, scene.keepVisible, settings, snapshot);
    }

    for (const inputName of settings.muteInputs) {
      try {
        const wasMuted = await this.obs.getInputMuted(inputName);
        snapshot.inputs.set(inputName, wasMuted);
        if (!wasMuted) {
          await this.obs.setInputMuted(inputName, true);
        }
      } catch (error) {
        this.logger.warn(`Could not mute OBS input "${inputName}"`, { error: messageOf(error) });
      }
    }

    this.logger.info('Break overlay applied', {
      sceneItems: snapshot.items.size,
      inputs: snapshot.inputs.size,
    });
    return snapshot;
  }

  /** Put back everything recorded in `snapshot`. Never throws; failures are logged. */
  async restore(snapshot: ObsBreakSnapshot): Promise<void> {
    if (snapshot.items.size === 0 && snapshot.inputs.size === 0) {
      return;
    }
    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.error(
        'OBS is not connected; cannot restore the break overlay. Check the facecam and mic.'
      );
      return;
    }

    for (const { sceneUuid, sceneItemId, enabled } of snapshot.items.values()) {
      try {
        await this.obs.setSceneItemEnabled(sceneUuid, sceneItemId, enabled);
      } catch (error) {
        // Most likely the scene or item was deleted during the break.
        this.logger.warn('Could not restore a scene item after the break', {
          sceneUuid,
          sceneItemId,
          error: messageOf(error),
        });
      }
    }

    for (const [inputName, wasMuted] of snapshot.inputs) {
      try {
        await this.obs.setInputMuted(inputName, wasMuted);
      } catch (error) {
        this.logger.error(`Could not restore OBS input "${inputName}" after the break`, error);
      }
    }

    this.logger.info('Break overlay restored');
  }

  /** Every scene UUID across all canvases, flagged if its name is in `keepVisibleInScenes`. */
  private async allScenes(
    keepVisibleInScenes: string[]
  ): Promise<{ uuid: string; keepVisible: boolean }[]> {
    let scenes: ObsScene[];
    try {
      scenes = (await listScenesByCanvas(this.obs)).flatMap((canvas) => canvas.scenes);
    } catch (error) {
      // A break should still cover what it can, so fall back to the main canvas.
      this.logger.warn('Could not list scenes on every OBS canvas; using the main canvas only', {
        error: messageOf(error),
      });
      scenes = await this.obs.getScenes().catch((fallbackError: unknown) => {
        this.logger.warn('Could not list OBS scenes', { error: messageOf(fallbackError) });
        return [];
      });
    }
    return scenes.map((scene) => ({
      uuid: scene.sceneUuid,
      keepVisible: keepVisibleInScenes.includes(scene.sceneName),
    }));
  }

  private async applyToScene(
    sceneUuid: string,
    keepVisible: boolean,
    settings: BreakSettings['obs'],
    snapshot: ObsBreakSnapshot
  ): Promise<void> {
    let items: Awaited<ReturnType<ObsIntegration['getSceneItems']>>;
    try {
      items = await this.obs.getSceneItems(sceneUuid);
    } catch (error) {
      this.logger.warn('Could not list scene items', { sceneUuid, error: messageOf(error) });
      return;
    }

    for (const item of items) {
      const target = settings.showSources.includes(item.sourceName)
        ? true
        : settings.hideSources.includes(item.sourceName) && !keepVisible
          ? false
          : null;
      if (target === null) {
        continue;
      }

      snapshot.items.set(`${sceneUuid}:${item.sceneItemId}`, {
        sceneUuid,
        sceneItemId: item.sceneItemId,
        enabled: item.sceneItemEnabled,
      });
      if (item.sceneItemEnabled === target) {
        continue;
      }
      try {
        await this.obs.setSceneItemEnabled(sceneUuid, item.sceneItemId, target);
      } catch (error) {
        this.logger.warn(`Could not ${target ? 'show' : 'hide'} "${item.sourceName}"`, {
          sceneUuid,
          error: messageOf(error),
        });
      }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
