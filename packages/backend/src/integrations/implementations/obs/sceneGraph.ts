import { messageOf } from '@turingmod/shared';
import type { ObsIntegration, ObsScene, ObsSceneItem } from './ObsIntegration.js';

/**
 * Walking OBS's scenes the way breaks and effects both need to: every scene on every canvas, and
 * every item in a scene including the ones inside its groups. A failure partway is reported and
 * skipped rather than ending the walk, so a break still covers everything it can reach.
 */

type SceneSource = Pick<ObsIntegration, 'getCanvases' | 'getScenes'>;
type ItemSource = Pick<ObsIntegration, 'getSceneItems' | 'getGroupItems'>;

/** Told about each part of OBS that couldn't be read and was skipped. */
export type OnSkipped = (what: string, error: unknown) => void;

/** The scenes on one canvas. `canvasUuid` is undefined for an OBS that predates canvases. */
export interface CanvasScenes {
  canvasUuid: string | undefined;
  scenes: ObsScene[];
}

/**
 * Every scene, grouped by canvas. An OBS without canvas support has only the main canvas, so it
 * comes back as one group with no canvas UUID; the scene methods default to the main canvas. A
 * canvas whose scenes can't be listed is skipped, and if the canvases themselves can't be
 * listed, the main canvas is all that is returned.
 */
export async function listScenesByCanvas(
  obs: SceneSource,
  onSkipped: OnSkipped
): Promise<CanvasScenes[]> {
  let canvases: Awaited<ReturnType<SceneSource['getCanvases']>>;
  try {
    canvases = await obs.getCanvases();
  } catch (error) {
    onSkipped('the list of canvases; using the main canvas only', error);
    canvases = [];
  }
  if (canvases.length === 0) {
    try {
      return [{ canvasUuid: undefined, scenes: await obs.getScenes() }];
    } catch (error) {
      onSkipped('the scenes on the main canvas', error);
      return [];
    }
  }

  const groups: CanvasScenes[] = [];
  for (const { canvasUuid, canvasName } of canvases) {
    try {
      groups.push({ canvasUuid, scenes: await obs.getScenes(canvasUuid) });
    } catch (error) {
      onSkipped(`the scenes on canvas "${canvasName}"`, error);
    }
  }
  return groups;
}

/** One item as placed in a scene, directly or inside one of its groups. */
export interface Placement {
  item: ObsSceneItem;
  /**
   * The UUID the item is addressed by: its scene's, or its group's when it is inside a group,
   * since obs-websocket treats a group as a scene for scene item requests.
   */
  containerUuid: string;
  /** Inside a group, so its position is relative to the group rather than the canvas. */
  inGroup: boolean;
}

/**
 * Every item in a scene: those placed directly in it, then those inside each of its groups (OBS
 * groups can't contain groups). A group whose items can't be listed is skipped.
 */
export async function listPlacements(
  obs: ItemSource,
  sceneUuid: string,
  onSkipped: OnSkipped
): Promise<Placement[]> {
  const items = await obs.getSceneItems(sceneUuid);
  const placements: Placement[] = items.map((item) => ({
    item,
    containerUuid: sceneUuid,
    inGroup: false,
  }));

  for (const { groupUuid, sourceName } of items) {
    if (groupUuid === undefined) continue;
    try {
      for (const item of await obs.getGroupItems(groupUuid)) {
        placements.push({ item, containerUuid: groupUuid, inGroup: true });
      }
    } catch (error) {
      onSkipped(`the items in group "${sourceName}"`, error);
    }
  }
  return placements;
}

/** An OnSkipped that logs a warning. */
export function warnSkipped(logger: {
  warn(message: string, ...args: unknown[]): void;
}): OnSkipped {
  return (what, error) =>
    logger.warn(`Could not read ${what} from OBS`, { error: messageOf(error) });
}
