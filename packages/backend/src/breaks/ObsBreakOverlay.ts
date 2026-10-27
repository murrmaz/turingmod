import { IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { ObsIntegration } from '../integrations/implementations/obs/ObsIntegration.js';
import {
  listPlacements,
  listScenesByCanvas,
  type Placement,
  warnSkipped,
} from '../integrations/implementations/obs/sceneGraph.js';
import { Logger } from '../utils/Logger.js';
import type { BreakSettings } from './breakSettings.js';

/** What the overlay changed, recorded before changing it, so restore() can put it back exactly. */
export interface ObsBreakSnapshot {
  /**
   * Original visibility of every scene item the overlay touched, keyed by `containerUuid:itemId`
   * (`sceneUuid` is the group's UUID for an item inside a group).
   */
  items: Map<string, { sceneUuid: string; sceneItemId: number; enabled: boolean }>;
  /** Original mute state of every input the overlay touched. */
  inputs: Map<string, boolean>;
}

/** Whether a snapshot records nothing, so there is nothing to put back. */
export function isEmptySnapshot(snapshot: ObsBreakSnapshot): boolean {
  return snapshot.items.size === 0 && snapshot.inputs.size === 0;
}

/**
 * Puts OBS into "break" state and back: hides the configured sources (facecam), shows the break
 * sources ("Ads Text") and mutes the configured inputs (mic).
 *
 * Every scene on every canvas is covered, not just the program scene: a non-main canvas such as
 * Aitum Vertical has no program scene obs-websocket can report, and covering all scenes also
 * means a scene switch mid-break doesn't put the streamer back on camera. Items inside groups
 * are covered too, so a facecam grouped with its frame is still hidden.
 *
 * Both directions set absolute states from a snapshot rather than toggling, so a mic that was
 * already muted stays muted afterwards, and a partial failure can't leave things inverted. Each
 * change is attempted independently: one missing source doesn't stop the rest. Applying again
 * over an existing snapshot is safe: what it already recorded keeps its pre-break value.
 */
@singleton()
export class ObsBreakOverlay {
  private logger: Logger;

  constructor(
    private obs: ObsIntegration,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ObsBreakOverlay' });
  }

  /**
   * Apply the break state and return what it changed, added to `recorded` (what an earlier apply
   * recorded and hasn't been restored yet), so the result always holds the pre-break state.
   * Never throws; failures are logged.
   */
  async apply(
    settings: BreakSettings['obs'],
    recorded?: ObsBreakSnapshot
  ): Promise<ObsBreakSnapshot> {
    const snapshot: ObsBreakSnapshot = {
      items: new Map(recorded?.items),
      inputs: new Map(recorded?.inputs),
    };

    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.warn('OBS is not connected; skipping the break overlay');
      return snapshot;
    }

    const seen = new Set<string>();
    for (const scene of await this.allScenes(settings.keepVisibleInScenes)) {
      await this.applyToScene(scene.uuid, scene.keepVisible, settings, snapshot, seen);
    }

    for (const inputName of settings.muteInputs) {
      try {
        const wasMuted = await this.obs.getInputMuted(inputName);
        if (!snapshot.inputs.has(inputName)) {
          snapshot.inputs.set(inputName, wasMuted);
        }
        if (!wasMuted) {
          await this.obs.setInputMuted(inputName, true);
        }
      } catch (error) {
        this.logger.warn(`Could not mute OBS input "${inputName}"`, { error });
      }
    }

    this.logger.info('Break overlay applied', {
      sceneItems: snapshot.items.size,
      inputs: snapshot.inputs.size,
    });
    return snapshot;
  }

  /**
   * Put back everything recorded in `snapshot`. Resolves to whether OBS was connected throughout,
   * so the restore is done: false means it is still owed. A source that can't be restored while
   * OBS is connected (most likely deleted) is logged and skipped. Never throws.
   */
  async restore(snapshot: ObsBreakSnapshot): Promise<boolean> {
    if (isEmptySnapshot(snapshot)) {
      return true;
    }
    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.warn(
        'OBS is not connected; the facecam and mic will be restored when it reconnects'
      );
      return false;
    }

    for (const { sceneUuid, sceneItemId, enabled } of snapshot.items.values()) {
      try {
        await this.obs.setSceneItemEnabled(sceneUuid, sceneItemId, enabled);
      } catch (error) {
        // Most likely the scene or item was deleted during the break.
        this.logger.warn('Could not restore a scene item after the break', {
          sceneUuid,
          sceneItemId,
          error,
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

    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.warn('OBS disconnected while restoring the break overlay; will retry');
      return false;
    }
    this.logger.info('Break overlay restored');
    return true;
  }

  /** Every scene UUID across all canvases, flagged if its name is in `keepVisibleInScenes`. */
  private async allScenes(
    keepVisibleInScenes: string[]
  ): Promise<{ uuid: string; keepVisible: boolean }[]> {
    const canvases = await listScenesByCanvas(this.obs, warnSkipped(this.logger));
    return canvases
      .flatMap((canvas) => canvas.scenes)
      .map((scene) => ({
        uuid: scene.sceneUuid,
        keepVisible: keepVisibleInScenes.includes(scene.sceneName),
      }));
  }

  private async applyToScene(
    sceneUuid: string,
    keepVisible: boolean,
    settings: BreakSettings['obs'],
    snapshot: ObsBreakSnapshot,
    seen: Set<string>
  ): Promise<void> {
    let placements: Placement[];
    try {
      placements = await listPlacements(this.obs, sceneUuid, warnSkipped(this.logger));
    } catch (error) {
      this.logger.warn('Could not list scene items', { sceneUuid, error });
      return;
    }

    for (const { item, containerUuid } of placements) {
      const target = settings.showSources.includes(item.sourceName)
        ? true
        : settings.hideSources.includes(item.sourceName) && !keepVisible
          ? false
          : null;
      if (target === null) {
        continue;
      }

      // A group's items are listed once per scene holding the group; the first sighting decides.
      const key = `${containerUuid}:${item.sceneItemId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      // Recorded once, ever: a later sighting would record the state an overlay already set.
      if (!snapshot.items.has(key)) {
        snapshot.items.set(key, {
          sceneUuid: containerUuid,
          sceneItemId: item.sceneItemId,
          enabled: item.sceneItemEnabled,
        });
      }
      if (item.sceneItemEnabled === target) {
        continue;
      }
      try {
        await this.obs.setSceneItemEnabled(containerUuid, item.sceneItemId, target);
      } catch (error) {
        this.logger.warn(`Could not ${target ? 'show' : 'hide'} "${item.sourceName}"`, {
          sceneUuid: containerUuid,
          error,
        });
      }
    }
  }
}
