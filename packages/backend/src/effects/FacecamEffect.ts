import type { SceneItemTransform } from '../integrations/implementations/obs/ObsIntegration.js';

/** The facecam as placed in one scene that an effect animates. */
export interface FacecamTarget {
  sceneUuid: string;
  sceneItemId: number;
  /** True for the program scene on the main canvas; false for another canvas's scene. */
  isMain: boolean;
  /** Its transform before the effect started; restored when the effect ends. */
  original: SceneItemTransform;
}

/**
 * What an effect is given to work with. Effects only describe motion: the runner finds the
 * facecam, serializes effects, and restores the facecam and removes added filters afterwards —
 * however the effect ends.
 */
export interface EffectContext {
  /** Every scene the facecam is animated in, main canvas first. Never empty. */
  readonly targets: readonly FacecamTarget[];
  /** Aborted when TuringMod is shutting down; effects should stop promptly. */
  readonly signal: AbortSignal;
  setTransform(target: FacecamTarget, transform: Partial<SceneItemTransform>): Promise<void>;
  /** The main canvas's resolution. */
  canvasSize(): Promise<{ width: number; height: number }>;
  /** Add a filter to the facecam source; removed automatically when the effect ends. */
  addFilter(name: string, kind: string, settings: Record<string, unknown>): Promise<void>;
  setFilterSettings(name: string, settings: Record<string, unknown>): Promise<void>;
  /** Wait, resolving early if the effect is aborted. */
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** A visual gag played on the facecam, such as a barrel roll. */
export interface FacecamEffect {
  readonly name: string;
  /** Only animate the main canvas (e.g. an effect that needs the canvas size). */
  readonly mainCanvasOnly?: boolean;
  run(context: EffectContext): Promise<void>;
}
