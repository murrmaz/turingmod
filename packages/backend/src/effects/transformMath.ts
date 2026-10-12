import type { SceneItemTransform } from '../integrations/implementations/obs/ObsIntegration.js';

/**
 * OBS alignment flags: which point of a scene item its position refers to, and the point it
 * rotates and scales around. Combine one horizontal and one vertical flag; neither means center.
 */
export const ALIGN = {
  CENTER: 0,
  LEFT: 1,
  RIGHT: 2,
  TOP: 4,
  BOTTOM: 8,
} as const;

export interface Point {
  x: number;
  y: number;
}

/** Where the anchor named by `alignment` sits, measured from the item's top-left corner. */
export function anchorOffset(alignment: number, width: number, height: number): Point {
  const x = alignment & ALIGN.LEFT ? 0 : alignment & ALIGN.RIGHT ? width : width / 2;
  const y = alignment & ALIGN.TOP ? 0 : alignment & ALIGN.BOTTOM ? height : height / 2;
  return { x, y };
}

/** The item's top-left corner on the canvas. Assumes it isn't rotated. */
export function topLeftOf(transform: SceneItemTransform): Point {
  const offset = anchorOffset(transform.alignment, transform.width, transform.height);
  return { x: transform.positionX - offset.x, y: transform.positionY - offset.y };
}

/**
 * The alignment and position that move the item's anchor to `alignment` without moving the item
 * on screen — so it can be rotated about its center, or squashed towards its bottom edge.
 * Assumes it isn't rotated.
 */
export function reanchor(
  transform: SceneItemTransform,
  alignment: number
): Pick<SceneItemTransform, 'alignment' | 'positionX' | 'positionY'> {
  const topLeft = topLeftOf(transform);
  const offset = anchorOffset(alignment, transform.width, transform.height);
  return { alignment, positionX: topLeft.x + offset.x, positionY: topLeft.y + offset.y };
}

/**
 * The fields an effect may change, taken from a transform so it can be written back. Width,
 * height and source size are derived by OBS and can't be set; bounds are never touched by
 * effects (and OBS rejects the zero bounds it reports for an item without them).
 */
export function restorableTransform(transform: SceneItemTransform): Partial<SceneItemTransform> {
  return {
    positionX: transform.positionX,
    positionY: transform.positionY,
    rotation: transform.rotation,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    alignment: transform.alignment,
    cropTop: transform.cropTop,
    cropBottom: transform.cropBottom,
    cropLeft: transform.cropLeft,
    cropRight: transform.cropRight,
  };
}
