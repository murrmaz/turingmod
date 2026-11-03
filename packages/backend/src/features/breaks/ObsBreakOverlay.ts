import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import type { ObsBreakSnapshot } from '../../database/repositories/ObsBreakRestoreRepository.js';
import { ObsIntegration } from '../../integrations/implementations/obs/ObsIntegration.js';
import {
  listPlacements,
  listScenesByCanvas,
  type OnSkipped,
  type Placement,
  warnSkipped,
} from '../../integrations/implementations/obs/sceneGraph.js';
import { Logger } from '../../utils/Logger.js';
import type { BreakSettings } from './breakSettings.js';

/** Whether a snapshot records nothing, so there is nothing to put back. */
export function isEmptySnapshot(snapshot: ObsBreakSnapshot): boolean {
  return snapshot.items.size === 0 && snapshot.inputs.size === 0;
}

/** How far applying or restoring got. */
export interface ObsBreakOutcome {
  /**
   * OBS stayed connected throughout. False means what's missing can be done when it reconnects,
   * so `failed` is empty: a request that fails as OBS goes away says nothing about the source.
   */
  connected: boolean;
  /** What OBS wouldn't do while connected, each with its reason, for the streamer to read. */
  failed: string[];
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
   * Never throws: what failed is logged and returned, for the caller to report.
   */
  async apply(
    settings: BreakSettings['obs'],
    recorded?: ObsBreakSnapshot
  ): Promise<ObsBreakOutcome & { snapshot: ObsBreakSnapshot }> {
    const snapshot: ObsBreakSnapshot = {
      items: new Map(recorded?.items),
      inputs: new Map(recorded?.inputs),
    };

    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.warn('OBS is not connected; skipping the break overlay');
      return { snapshot, connected: false, failed: [] };
    }

    // A set, since one source that can't be changed fails the same way in every scene holding it.
    const failed = new Set<string>();
    const seen = new Set<string>();
    for (const scene of await this.allScenes(settings.keepVisibleInScenes, failed)) {
      await this.applyToScene(scene.uuid, scene.keepVisible, settings, snapshot, seen, failed);
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
        failed.add(`mute "${inputName}" (${messageOf(error)})`);
      }
    }

    this.logger.info('Break overlay applied', {
      sceneItems: snapshot.items.size,
      inputs: snapshot.inputs.size,
    });
    return { snapshot, ...this.outcome(failed) };
  }

  /**
   * Put back everything recorded in `snapshot`. If OBS wasn't connected throughout, the restore is
   * still owed (`connected` is false). If it was, the restore is done, and what OBS wouldn't put
   * back (most likely deleted) is in `failed`, since trying again wouldn't help. Never throws.
   */
  async restore(snapshot: ObsBreakSnapshot): Promise<ObsBreakOutcome> {
    if (isEmptySnapshot(snapshot)) {
      return { connected: true, failed: [] };
    }
    if (this.obs.getStatus() !== IntegrationStatus.CONNECTED) {
      this.logger.warn(
        'OBS is not connected; the facecam and mic will be restored when it reconnects'
      );
      return { connected: false, failed: [] };
    }

    const failed = new Set<string>();
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
        // The snapshot holds only ids: a source's name may be gone along with the source.
        failed.add(`show or hide scene item ${sceneItemId} (${messageOf(error)})`);
      }
    }

    for (const [inputName, wasMuted] of snapshot.inputs) {
      try {
        await this.obs.setInputMuted(inputName, wasMuted);
      } catch (error) {
        this.logger.error(`Could not restore OBS input "${inputName}" after the break`, error);
        failed.add(`${wasMuted ? 'mute' : 'unmute'} "${inputName}" (${messageOf(error)})`);
      }
    }

    const outcome = this.outcome(failed);
    if (outcome.connected) {
      this.logger.info('Break overlay restored');
    } else {
      this.logger.warn('OBS disconnected while restoring the break overlay; will retry');
    }
    return outcome;
  }

  /** The outcome of work that has finished, given what failed along the way. */
  private outcome(failed: Set<string>): ObsBreakOutcome {
    return this.obs.getStatus() === IntegrationStatus.CONNECTED
      ? { connected: true, failed: [...failed] }
      : { connected: false, failed: [] };
  }

  /** Logs a part of OBS that couldn't be read, and counts it as failed: the break missed it. */
  private onSkipped(failed: Set<string>): OnSkipped {
    const warn = warnSkipped(this.logger);
    return (what, error) => {
      warn(what, error);
      failed.add(`read ${what} (${messageOf(error)})`);
    };
  }

  /** Every scene UUID across all canvases, flagged if its name is in `keepVisibleInScenes`. */
  private async allScenes(
    keepVisibleInScenes: string[],
    failed: Set<string>
  ): Promise<{ uuid: string; keepVisible: boolean }[]> {
    const canvases = await listScenesByCanvas(this.obs, this.onSkipped(failed));
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
    seen: Set<string>,
    failed: Set<string>
  ): Promise<void> {
    let placements: Placement[];
    try {
      placements = await listPlacements(this.obs, sceneUuid, this.onSkipped(failed));
    } catch (error) {
      this.logger.warn('Could not list scene items', { sceneUuid, error });
      failed.add(`read the items in a scene (${messageOf(error)})`);
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
        failed.add(`${target ? 'show' : 'hide'} "${item.sourceName}" (${messageOf(error)})`);
      }
    }
  }
}
