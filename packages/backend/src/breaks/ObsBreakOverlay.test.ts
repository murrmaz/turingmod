import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ObsCanvas,
  ObsIntegration,
  ObsScene,
  ObsSceneItem,
} from '../integrations/implementations/obs/ObsIntegration.js';
import { Logger } from '../utils/Logger.js';
import { DEFAULT_BREAK_SETTINGS } from './breakSettings.js';
import { ObsBreakOverlay } from './ObsBreakOverlay.js';

/** An in-memory OBS: canvases → scenes → items, plus input mute states. */
class FakeObs {
  status = IntegrationStatus.CONNECTED;
  canvases: ObsCanvas[] = [];
  scenesByCanvas = new Map<string | undefined, ObsScene[]>();
  items = new Map<string, ObsSceneItem[]>();
  muted = new Map<string, boolean>();
  failSetFor = new Set<string>();

  getStatus() {
    return this.status;
  }
  getCanvases() {
    return Promise.resolve(this.canvases);
  }
  getScenes(canvasUuid?: string) {
    return Promise.resolve(this.scenesByCanvas.get(canvasUuid) ?? []);
  }
  getSceneItems(sceneUuid: string) {
    return Promise.resolve((this.items.get(sceneUuid) ?? []).map((item) => ({ ...item })));
  }
  setSceneItemEnabled(sceneUuid: string, sceneItemId: number, enabled: boolean) {
    const item = this.items.get(sceneUuid)?.find((i) => i.sceneItemId === sceneItemId);
    if (!item || this.failSetFor.has(item.sourceName)) {
      return Promise.reject(new Error('No source was found'));
    }
    item.sceneItemEnabled = enabled;
    return Promise.resolve();
  }
  getInputMuted(inputName: string) {
    const muted = this.muted.get(inputName);
    return muted === undefined
      ? Promise.reject(new Error('No source was found'))
      : Promise.resolve(muted);
  }
  setInputMuted(inputName: string, muted: boolean) {
    this.muted.set(inputName, muted);
    return Promise.resolve();
  }

  visible(sceneUuid: string, sourceName: string) {
    return this.items.get(sceneUuid)?.find((i) => i.sourceName === sourceName)?.sceneItemEnabled;
  }
}

const item = (sceneItemId: number, sourceName: string, sceneItemEnabled: boolean) => ({
  sceneItemId,
  sourceName,
  sceneItemEnabled,
});

describe('ObsBreakOverlay', () => {
  let obs: FakeObs;
  let overlay: ObsBreakOverlay;
  const settings = DEFAULT_BREAK_SETTINGS.obs; // Facecam / Ads Text / Mic/Aux

  beforeEach(() => {
    obs = new FakeObs();
    overlay = new ObsBreakOverlay(
      obs as unknown as ObsIntegration,
      new Logger({ level: 'silent' })
    );

    obs.canvases = [
      { canvasUuid: 'main', canvasName: 'Main' },
      { canvasUuid: 'vert', canvasName: 'Aitum Vertical' },
    ];
    obs.scenesByCanvas.set('main', [
      { sceneName: 'Gameplay', sceneUuid: 'gameplay' },
      { sceneName: 'Just Chatting', sceneUuid: 'chatting' },
    ]);
    obs.scenesByCanvas.set('vert', [{ sceneName: 'Gameplay', sceneUuid: 'vert-gameplay' }]);
    obs.items.set('gameplay', [
      item(1, 'Facecam', true),
      item(2, 'Ads Text', false),
      item(3, 'Game', true),
    ]);
    obs.items.set('chatting', [item(1, 'Facecam', true)]);
    obs.items.set('vert-gameplay', [item(7, 'Facecam', true), item(8, 'Ads Text', false)]);
    obs.muted.set('Mic/Aux', false);
  });

  it('hides the facecam, shows the break text and mutes the mic on every canvas and scene', async () => {
    await overlay.apply(settings);

    expect(obs.visible('gameplay', 'Facecam')).toBe(false);
    expect(obs.visible('gameplay', 'Ads Text')).toBe(true);
    expect(obs.visible('gameplay', 'Game')).toBe(true);
    expect(obs.visible('chatting', 'Facecam')).toBe(false);
    expect(obs.visible('vert-gameplay', 'Facecam')).toBe(false);
    expect(obs.visible('vert-gameplay', 'Ads Text')).toBe(true);
    expect(obs.muted.get('Mic/Aux')).toBe(true);
  });

  it('restores exactly the pre-break state', async () => {
    const snapshot = await overlay.apply(settings);
    await overlay.restore(snapshot);

    expect(obs.visible('gameplay', 'Facecam')).toBe(true);
    expect(obs.visible('gameplay', 'Ads Text')).toBe(false);
    expect(obs.visible('vert-gameplay', 'Facecam')).toBe(true);
    expect(obs.muted.get('Mic/Aux')).toBe(false);
  });

  it('leaves a mic that was already muted muted afterwards (absolute, not toggled)', async () => {
    obs.muted.set('Mic/Aux', true);

    await overlay.restore(await overlay.apply(settings));

    expect(obs.muted.get('Mic/Aux')).toBe(true);
  });

  it('leaves the facecam alone in scenes listed in keepVisibleInScenes', async () => {
    await overlay.apply({ ...settings, keepVisibleInScenes: ['Just Chatting'] });

    expect(obs.visible('chatting', 'Facecam')).toBe(true);
    expect(obs.visible('gameplay', 'Facecam')).toBe(false);
  });

  it('falls back to the main canvas when OBS predates canvases', async () => {
    obs.canvases = [];
    obs.scenesByCanvas.set(undefined, [{ sceneName: 'Gameplay', sceneUuid: 'gameplay' }]);

    await overlay.apply(settings);

    expect(obs.visible('gameplay', 'Facecam')).toBe(false);
  });

  it('carries on past a source or input it cannot change', async () => {
    obs.failSetFor.add('Ads Text');
    obs.muted.delete('Mic/Aux');

    await overlay.apply(settings);

    expect(obs.visible('gameplay', 'Facecam')).toBe(false);
    expect(obs.visible('vert-gameplay', 'Facecam')).toBe(false);
  });

  it('does nothing when OBS is not connected', async () => {
    obs.status = IntegrationStatus.DISCONNECTED;

    const snapshot = await overlay.apply(settings);

    expect(snapshot.items.size).toBe(0);
    expect(obs.visible('gameplay', 'Facecam')).toBe(true);
  });
});
