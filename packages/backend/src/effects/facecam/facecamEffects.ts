import type { FacecamEffect } from '../FacecamEffect.js';
import { ALIGN, reanchor, topLeftOf } from '../transformMath.js';
import { animate, setAll } from './animate.js';

/** How long the held effects (flip, stretch, squish) last, as in the original bot. */
export const HOLD_MS = 10_000;

/**
 * One full turn about the facecam's center.
 *
 * Like the other effects, these assume the facecam isn't rotated to begin with: moving its
 * anchor without moving it on screen is only that simple for an unrotated item.
 */
export const barrelRoll: FacecamEffect = {
  name: 'Barrel Roll',
  run: (context) =>
    animate(context, 2_000, (progress) =>
      setAll(context, ({ original }) => ({
        ...reanchor(original, ALIGN.CENTER),
        rotation: (original.rotation + 360 * progress) % 360,
      }))
    ),
};

/** Upside down, as if from a land down under. */
export const australia: FacecamEffect = {
  name: 'Australia',
  run: async (context) => {
    await setAll(context, ({ original }) => ({
      ...reanchor(original, ALIGN.CENTER),
      rotation: (original.rotation + 180) % 360,
    }));
    await context.sleep(HOLD_MS);
  },
};

/** Stretched about its center: "Wide Pope" horizontally, "Long Pope" vertically. */
export function stretch(axis: 'wide' | 'long', factor = 4): FacecamEffect {
  return {
    name: axis === 'wide' ? 'Wide Pope' : 'Long Pope',
    run: async (context) => {
      await setAll(context, ({ original }) => ({
        ...reanchor(original, ALIGN.CENTER),
        ...(axis === 'wide'
          ? { scaleX: original.scaleX * factor }
          : { scaleY: original.scaleY * factor }),
      }));
      await context.sleep(HOLD_MS);
    },
  };
}

/**
 * Squashed to half size by a bonk: flattened onto its bottom edge, or pinched in from the sides.
 */
export function squish(direction: 'flat' | 'thin'): FacecamEffect {
  return {
    name: direction === 'flat' ? 'Bonk (flat)' : 'Bonk (thin)',
    run: async (context) => {
      await setAll(context, ({ original }) =>
        direction === 'flat'
          ? { ...reanchor(original, ALIGN.BOTTOM), scaleY: original.scaleY / 2 }
          : { ...reanchor(original, ALIGN.CENTER), scaleX: original.scaleX / 2 }
      );
      await context.sleep(HOLD_MS);
    },
  };
}

/** Filter that tints the facecam while it bounces. */
export const SCREENSAVER_FILTER = 'TuringMod Screensaver Tint';

/** Tints the screensaver cycles through, from the original bot (OBS `color_add` values). */
export const SCREENSAVER_COLORS = [16711680, 16753920, 16776960, 32768, 255, 15631086, 8388736];

const SCREENSAVER_MS = 30_000;

/** Speed along one axis in canvas pixels per second, with a random direction. */
function randomVelocity(): number {
  const speed = 250 + Math.random() * 200;
  return Math.random() < 0.5 ? -speed : speed;
}

function nextColor(current: number | undefined): number {
  const choices = SCREENSAVER_COLORS.filter((color) => color !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? SCREENSAVER_COLORS[0] ?? 0;
}

/**
 * The facecam bounces around the canvas like a DVD screensaver for 30 seconds, changing tint
 * each time it hits an edge. Main canvas only: it needs the canvas size to bounce off.
 */
export const screensaver: FacecamEffect = {
  name: 'Screen Saver Camera',
  mainCanvasOnly: true,
  run: async (context) => {
    const target = context.targets[0];
    if (!target) return;
    const { original } = target;
    const canvas = await context.canvasSize();
    const maxX = Math.max(0, canvas.width - original.width);
    const maxY = Math.max(0, canvas.height - original.height);

    let { x, y } = topLeftOf(original);
    // A facecam as big as the canvas along an axis has nowhere to go along it.
    let vx = maxX > 0 ? randomVelocity() : 0;
    let vy = maxY > 0 ? randomVelocity() : 0;
    let color = nextColor(undefined);
    await context.addFilter(SCREENSAVER_FILTER, 'color_filter_v2', { color_add: color });

    let last = context.now();
    await animate(context, SCREENSAVER_MS, async () => {
      const now = context.now();
      const seconds = (now - last) / 1000;
      last = now;

      x += vx * seconds;
      y += vy * seconds;
      let bounced = false;
      if (x < 0 || x > maxX) {
        x = Math.min(maxX, Math.max(0, x));
        vx = -vx;
        bounced = true;
      }
      if (y < 0 || y > maxY) {
        y = Math.min(maxY, Math.max(0, y));
        vy = -vy;
        bounced = true;
      }

      await context.setTransform(target, {
        alignment: ALIGN.TOP | ALIGN.LEFT,
        positionX: x,
        positionY: y,
      });
      if (bounced) {
        color = nextColor(color);
        await context.setFilterSettings(SCREENSAVER_FILTER, { color_add: color });
      }
    });
  },
};
