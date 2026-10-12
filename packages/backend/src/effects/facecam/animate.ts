import type { SceneItemTransform } from '../../integrations/implementations/obs/ObsIntegration.js';
import type { EffectContext, FacecamTarget } from '../FacecamEffect.js';

/** Delay between animation frames; each frame also waits on an OBS round trip. */
export const FRAME_MS = 16;

/**
 * Call `frame` with progress from 0 to 1 over `durationMs`, ending on exactly 1 unless the effect
 * is aborted first. Time-based, so a slow OBS drops frames rather than slowing the animation.
 */
export async function animate(
  context: EffectContext,
  durationMs: number,
  frame: (progress: number) => Promise<unknown>
): Promise<void> {
  const start = context.now();
  for (;;) {
    if (context.signal.aborted) return;
    const progress = Math.min(1, (context.now() - start) / durationMs);
    await frame(progress);
    if (progress >= 1) return;
    await context.sleep(FRAME_MS);
  }
}

/** Apply a transform to every target, each computed from that target. */
export async function setAll(
  context: EffectContext,
  transformFor: (target: FacecamTarget) => Partial<SceneItemTransform>
): Promise<void> {
  await Promise.all(
    context.targets.map((target) => context.setTransform(target, transformFor(target)))
  );
}
