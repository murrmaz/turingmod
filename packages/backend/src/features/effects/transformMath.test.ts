import { describe, expect, it } from 'vitest';
import { transform } from './testing.js';
import { ALIGN, anchorOffset, reanchor, restorableTransform, topLeftOf } from './transformMath.js';

describe('transformMath', () => {
  it('locates each anchor from the top-left corner', () => {
    expect(anchorOffset(ALIGN.TOP | ALIGN.LEFT, 400, 200)).toEqual({ x: 0, y: 0 });
    expect(anchorOffset(ALIGN.CENTER, 400, 200)).toEqual({ x: 200, y: 100 });
    expect(anchorOffset(ALIGN.BOTTOM | ALIGN.RIGHT, 400, 200)).toEqual({ x: 400, y: 200 });
    expect(anchorOffset(ALIGN.BOTTOM, 400, 200)).toEqual({ x: 200, y: 200 });
  });

  it('finds the top-left corner whatever the alignment', () => {
    expect(topLeftOf(transform())).toEqual({ x: 100, y: 50 });
    expect(
      topLeftOf(transform({ alignment: ALIGN.CENTER, positionX: 300, positionY: 150 }))
    ).toEqual({ x: 100, y: 50 });
  });

  it('moves the anchor without moving the item', () => {
    expect(reanchor(transform(), ALIGN.CENTER)).toEqual({
      alignment: ALIGN.CENTER,
      positionX: 300,
      positionY: 150,
    });
    expect(
      reanchor(transform({ alignment: ALIGN.CENTER, positionX: 300, positionY: 150 }), ALIGN.BOTTOM)
    ).toEqual({ alignment: ALIGN.BOTTOM, positionX: 300, positionY: 250 });
  });

  it('restores only fields OBS accepts, leaving bounds alone', () => {
    const restorable = restorableTransform(transform({ cropLeft: 10 }));
    expect(restorable).toMatchObject({ positionX: 100, scaleX: 0.5, cropLeft: 10 });
    expect(restorable).not.toHaveProperty('width');
    expect(restorable).not.toHaveProperty('sourceWidth');
    expect(restorable).not.toHaveProperty('boundsWidth');
  });
});
