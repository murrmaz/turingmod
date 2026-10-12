import type { SceneItemTransform } from '../integrations/implementations/obs/ObsIntegration.js';
import { ALIGN } from './transformMath.js';

/**
 * Test fixture: a 400×200 facecam at (100, 50), anchored top-left, unrotated, without bounds.
 * Lives outside the test files so suites can share it without importing one another.
 */
export const transform = (overrides: Partial<SceneItemTransform> = {}): SceneItemTransform => ({
  positionX: 100,
  positionY: 50,
  rotation: 0,
  scaleX: 0.5,
  scaleY: 0.5,
  width: 400,
  height: 200,
  sourceWidth: 800,
  sourceHeight: 400,
  alignment: ALIGN.TOP | ALIGN.LEFT,
  boundsType: 'OBS_BOUNDS_NONE',
  boundsAlignment: 0,
  boundsWidth: 0,
  boundsHeight: 0,
  cropBottom: 0,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  ...overrides,
});
