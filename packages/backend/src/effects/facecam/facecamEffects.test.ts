import { describe, expect, it, vi } from 'vitest';
import type { SceneItemTransform } from '../../integrations/implementations/obs/ObsIntegration.js';
import type { EffectContext, FacecamTarget } from '../FacecamEffect.js';
import { transform } from '../testing.js';
import { ALIGN } from '../transformMath.js';
import {
  australia,
  barrelRoll,
  HOLD_MS,
  SCREENSAVER_FILTER,
  screensaver,
  squish,
  stretch,
} from './facecamEffects.js';

/** A context on a fake clock: sleeping advances time instantly. */
function fakeContext(targets: FacecamTarget[]) {
  let time = 0;
  const writes: { target: FacecamTarget; transform: Partial<SceneItemTransform> }[] = [];
  const context = {
    targets,
    signal: new AbortController().signal,
    setTransform: vi.fn((target: FacecamTarget, t: Partial<SceneItemTransform>) => {
      writes.push({ target, transform: t });
      return Promise.resolve();
    }),
    canvasSize: () => Promise.resolve({ width: 1920, height: 1080 }),
    addFilter: vi.fn(() => Promise.resolve()),
    setFilterSettings: vi.fn(() => Promise.resolve()),
    sleep: vi.fn((ms: number) => {
      time += ms;
      return Promise.resolve();
    }),
    now: () => time,
  } satisfies EffectContext;
  return { context, writes, elapsed: () => time };
}

const target = (overrides: Partial<SceneItemTransform> = {}, isMain = true): FacecamTarget => ({
  sceneUuid: isMain ? 'main' : 'vertical',
  sceneItemId: 1,
  isMain,
  original: transform(overrides),
});

describe('facecam effects', () => {
  it('Barrel Roll turns once about the center on every canvas, ending where it began', async () => {
    const { context, writes } = fakeContext([target(), target({}, false)]);

    await barrelRoll.run(context);

    for (const t of context.targets) {
      const mine = writes.filter((w) => w.target === t).map((w) => w.transform);
      expect(mine[0]).toMatchObject({ alignment: ALIGN.CENTER, positionX: 300, positionY: 150 });
      expect(mine.at(-1)?.rotation).toBe(0);
      expect(mine.some((w) => (w.rotation ?? 0) > 170 && (w.rotation ?? 0) < 190)).toBe(true);
    }
  });

  it('Australia holds the facecam upside down in place', async () => {
    const { context, writes, elapsed } = fakeContext([target()]);

    await australia.run(context);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.transform).toEqual({
      alignment: ALIGN.CENTER,
      positionX: 300,
      positionY: 150,
      rotation: 180,
    });
    expect(elapsed()).toBe(HOLD_MS);
  });

  it('Wide and Long Pope stretch one axis about the center', async () => {
    const wide = fakeContext([target()]);
    await stretch('wide').run(wide.context);
    expect(wide.writes[0]?.transform).toMatchObject({ scaleX: 2, alignment: ALIGN.CENTER });
    expect(wide.writes[0]?.transform).not.toHaveProperty('scaleY');

    const long = fakeContext([target()]);
    await stretch('long').run(long.context);
    expect(long.writes[0]?.transform).toMatchObject({ scaleY: 2 });
  });

  it('a flat bonk squashes onto the bottom edge; a thin one pinches about the center', async () => {
    const flat = fakeContext([target()]);
    await squish('flat').run(flat.context);
    expect(flat.writes[0]?.transform).toEqual({
      alignment: ALIGN.BOTTOM,
      positionX: 300,
      positionY: 250,
      scaleY: 0.25,
    });

    const thin = fakeContext([target()]);
    await squish('thin').run(thin.context);
    expect(thin.writes[0]?.transform).toMatchObject({ alignment: ALIGN.CENTER, scaleX: 0.25 });
  });

  it('Screen Saver Camera bounces within the canvas, re-tinting on every bounce', async () => {
    const { context, writes, elapsed } = fakeContext([target()]);

    await screensaver.run(context);

    expect(context.addFilter).toHaveBeenCalledWith(SCREENSAVER_FILTER, 'color_filter_v2', {
      color_add: expect.any(Number),
    });
    for (const { transform: t } of writes) {
      expect(t.positionX).toBeGreaterThanOrEqual(0);
      expect(t.positionX).toBeLessThanOrEqual(1920 - 400);
      expect(t.positionY).toBeGreaterThanOrEqual(0);
      expect(t.positionY).toBeLessThanOrEqual(1080 - 200);
    }
    // 30 seconds at over 250px/s in each direction can't avoid the edges.
    expect(context.setFilterSettings.mock.calls.length).toBeGreaterThan(3);
    const tints = context.setFilterSettings.mock.calls.map(
      (call) => (call as unknown as [string, { color_add: number }])[1].color_add
    );
    expect(tints.every((tint, i) => i === 0 || tint !== tints[i - 1])).toBe(true);
    expect(elapsed()).toBeGreaterThanOrEqual(30_000);
  });

  it('stops animating promptly once aborted', async () => {
    const controller = new AbortController();
    const { context, writes } = fakeContext([target()]);
    const aborting = {
      ...context,
      signal: controller.signal,
      sleep: (ms: number) => {
        controller.abort();
        return context.sleep(ms);
      },
    };

    await barrelRoll.run(aborting);

    expect(writes).toHaveLength(1);
  });
});
