import type { ObsIntegration, ObsScene } from './ObsIntegration.js';

/** The scenes on one canvas. `canvasUuid` is undefined for an OBS that predates canvases. */
export interface CanvasScenes {
  canvasUuid: string | undefined;
  scenes: ObsScene[];
}

/**
 * Every scene, grouped by canvas. An OBS without canvas support has only the main canvas, so it
 * comes back as one group with no canvas UUID; the scene methods default to the main canvas.
 */
export async function listScenesByCanvas(
  obs: Pick<ObsIntegration, 'getCanvases' | 'getScenes'>
): Promise<CanvasScenes[]> {
  const canvases = await obs.getCanvases();
  if (canvases.length === 0) {
    return [{ canvasUuid: undefined, scenes: await obs.getScenes() }];
  }

  const groups: CanvasScenes[] = [];
  for (const { canvasUuid } of canvases) {
    groups.push({ canvasUuid, scenes: await obs.getScenes(canvasUuid) });
  }
  return groups;
}
