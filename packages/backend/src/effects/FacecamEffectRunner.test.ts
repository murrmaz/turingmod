import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ServiceErrorEvent } from '../core/events.js';
import type {
  SettingsDefinition,
  SettingsRepository,
} from '../database/repositories/SettingsRepository.js';
import type {
  ObsCanvas,
  ObsIntegration,
  ObsScene,
  ObsSceneItem,
  SceneItemTransform,
} from '../integrations/implementations/obs/ObsIntegration.js';
import type { Logger } from '../utils/Logger.js';
import type { EffectContext, FacecamEffect } from './FacecamEffect.js';
import { FacecamEffectRunner } from './FacecamEffectRunner.js';
import { transform } from './testing.js';
import { restorableTransform } from './transformMath.js';

const makeLogger = () => {
  const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger & typeof logger;
};

/** OBS with a main canvas (program scene "main-live") and an Aitum Vertical canvas. */
class FakeObs {
  readonly name = 'obs';
  status = IntegrationStatus.CONNECTED;
  programUuid = 'main-live';
  canvases: ObsCanvas[] = [
    { canvasUuid: 'main', canvasName: 'Main' },
    { canvasUuid: 'vertical', canvasName: 'Aitum Vertical' },
  ];
  scenes = new Map<string, ObsScene[]>([
    [
      'main',
      [
        { sceneName: 'Live', sceneUuid: 'main-live' },
        { sceneName: 'BRB', sceneUuid: 'main-brb' },
      ],
    ],
    [
      'vertical',
      [
        { sceneName: 'Chat', sceneUuid: 'vert-chat' },
        { sceneName: 'Cam', sceneUuid: 'vert-cam' },
      ],
    ],
  ]);
  items = new Map<string, ObsSceneItem[]>([
    [
      'main-live',
      [{ sceneItemId: 7, sourceName: 'Facecam', sceneItemEnabled: true, groupUuid: undefined }],
    ],
    [
      'main-brb',
      [{ sceneItemId: 8, sourceName: 'Facecam', sceneItemEnabled: true, groupUuid: undefined }],
    ],
    ['vert-chat', []],
    [
      'vert-cam',
      [{ sceneItemId: 3, sourceName: 'Facecam', sceneItemEnabled: true, groupUuid: undefined }],
    ],
  ]);
  transforms = new Map<string, SceneItemTransform>([
    ['main-live:7', transform()],
    ['vert-cam:3', transform({ positionX: 10 })],
  ]);
  writes: { key: string; transform: Partial<SceneItemTransform> }[] = [];
  filters = new Set<string>();

  getStatus = () => this.status;
  getCurrentSceneUuid = () => Promise.resolve(this.programUuid);
  getCanvases = () => Promise.resolve(this.canvases);
  getScenes = (canvasUuid?: string) => Promise.resolve(this.scenes.get(canvasUuid ?? '') ?? []);
  getSceneItems = (sceneUuid: string) => Promise.resolve(this.items.get(sceneUuid) ?? []);
  /** A group's items live in `items` under its UUID, as obs-websocket addresses them. */
  getGroupItems = (groupUuid: string) => this.getSceneItems(groupUuid);
  getSceneItemTransform = (sceneUuid: string, id: number) =>
    Promise.resolve({ ...(this.transforms.get(`${sceneUuid}:${id}`) ?? transform()) });
  setSceneItemTransform = vi.fn((sceneUuid: string, id: number, t: Partial<SceneItemTransform>) => {
    this.writes.push({ key: `${sceneUuid}:${id}`, transform: t });
    return Promise.resolve();
  });
  getCanvasSize = () => Promise.resolve({ width: 1920, height: 1080 });
  addFilter = vi.fn((_source: string, name: string) => {
    this.filters.add(name);
    return Promise.resolve();
  });
  setFilterSettings = vi.fn(() => Promise.resolve());
  removeFilter = vi.fn((_source: string, name: string) => {
    this.filters.delete(name);
    return Promise.resolve();
  });

  lastWrite(key: string) {
    return this.writes.filter((w) => w.key === key).at(-1)?.transform;
  }
}

function mainTarget(context: EffectContext) {
  const target = context.targets[0];
  if (!target) throw new Error('no target');
  return target;
}

const effect = (
  run: (context: EffectContext) => Promise<void>,
  usesCanvasSize = false
): FacecamEffect => ({ name: 'Test', usesCanvasSize, run });

/** setSceneItemTransform as FakeObs starts out: records the write and succeeds. */
const accepted =
  (obs: FakeObs) => (sceneUuid: string, id: number, t: Partial<SceneItemTransform>) => {
    obs.writes.push({ key: `${sceneUuid}:${id}`, transform: t });
    return Promise.resolve();
  };

describe('FacecamEffectRunner', () => {
  let obs: FakeObs;
  let settings: unknown;
  let logger: ReturnType<typeof makeLogger>;
  let runner: FacecamEffectRunner;
  let eventBus: EventBus;
  let reported: ServiceErrorEvent[];

  /** OBS going away, so every request fails until it returns, as ObsIntegration behaves. */
  const obsDrops = () => {
    obs.status = IntegrationStatus.CONNECTING;
    const gone = () => Promise.reject(new Error('OBS is not connected'));
    obs.setSceneItemTransform.mockImplementation(gone);
    obs.removeFilter.mockImplementation(gone);
  };

  /** OBS back, accepting requests again, as IntegrationManager reports it. */
  const obsReturns = () => {
    obs.status = IntegrationStatus.CONNECTED;
    obs.setSceneItemTransform.mockImplementation(accepted(obs));
    obs.removeFilter.mockImplementation((_source, name) => {
      obs.filters.delete(name);
      return Promise.resolve();
    });
    return eventBus.emit('integration.status', { name: 'obs', status: obs.status });
  };

  beforeEach(() => {
    obs = new FakeObs();
    settings = null;
    logger = makeLogger();
    eventBus = new EventBus(logger);
    reported = [];
    eventBus.on('service.error', (event) => {
      reported.push(event);
    });
    runner = new FacecamEffectRunner(
      eventBus,
      obs as unknown as ObsIntegration,
      {
        get: (definition: SettingsDefinition<unknown>) => definition.schema.parse(settings ?? {}),
      } as unknown as SettingsRepository,
      logger
    );
    runner.start();
  });

  it("finds the facecam in the program scene and in the vertical canvas's first scene with it", async () => {
    let seen: EffectContext['targets'] = [];
    await runner.run(
      effect((context) => {
        seen = context.targets;
        return Promise.resolve();
      })
    );

    expect(seen.map((t) => [t.sceneUuid, t.sceneItemId, t.isMain])).toEqual([
      ['main-live', 7, true],
      ['vert-cam', 3, false],
    ]);
    expect(seen[1]?.original.positionX).toBe(10);
  });

  it('finds a facecam inside a group and animates it through the group', async () => {
    obs.items.set('main-live', [
      { sceneItemId: 2, sourceName: 'Camera', sceneItemEnabled: true, groupUuid: 'cam-group' },
    ]);
    obs.items.set('cam-group', [
      { sceneItemId: 5, sourceName: 'Facecam', sceneItemEnabled: true, groupUuid: undefined },
    ]);

    let seen: EffectContext['targets'] = [];
    await runner.run(
      effect(async (context) => {
        seen = context.targets;
        await context.setTransform(mainTarget(context), { rotation: 90 });
      })
    );

    expect(seen[0]).toMatchObject({ sceneUuid: 'cam-group', sceneItemId: 5, isMain: true });
    expect(obs.lastWrite('cam-group:5')).toEqual(restorableTransform(transform()));
  });

  it("refuses to move a grouped facecam around the canvas, since it's placed relative to the group", async () => {
    obs.items.set('main-live', [
      { sceneItemId: 2, sourceName: 'Camera', sceneItemEnabled: true, groupUuid: 'cam-group' },
    ]);
    obs.items.set('cam-group', [
      { sceneItemId: 5, sourceName: 'Facecam', sceneItemEnabled: true, groupUuid: undefined },
    ]);
    const run = vi.fn(() => Promise.resolve());

    await expect(runner.run(effect(run, true))).rejects.toThrow(/inside a group/);
    expect(run).not.toHaveBeenCalled();
  });

  it('only uses the main canvas for an effect that uses the canvas size', async () => {
    let seen: EffectContext['targets'] = [];
    await runner.run(
      effect((context) => {
        seen = context.targets;
        return Promise.resolve();
      }, true)
    );

    expect(seen.map((t) => t.sceneUuid)).toEqual(['main-live']);
  });

  it('works with an OBS that predates canvases', async () => {
    obs.canvases = [];
    let seen: EffectContext['targets'] = [];
    await runner.run(
      effect((context) => {
        seen = context.targets;
        return Promise.resolve();
      })
    );

    expect(seen.map((t) => t.sceneUuid)).toEqual(['main-live']);
  });

  it('uses the configured source name', async () => {
    settings = { facecamSource: 'Cam' };
    obs.items.set('main-live', [
      { sceneItemId: 9, sourceName: 'Cam', sceneItemEnabled: true, groupUuid: undefined },
    ]);

    let seen: EffectContext['targets'] = [];
    await runner.run(
      effect((context) => {
        seen = context.targets;
        return Promise.resolve();
      })
    );

    expect(seen.map((t) => t.sceneItemId)).toEqual([9]);
  });

  it('restores every target and removes added filters after the effect', async () => {
    await runner.run(
      effect(async (context) => {
        await context.addFilter('Tint', 'color_filter_v2', { color_add: 1 });
        for (const target of context.targets) {
          await context.setTransform(target, { rotation: 90 });
        }
      })
    );

    expect(obs.lastWrite('main-live:7')).toEqual(restorableTransform(transform()));
    expect(obs.lastWrite('vert-cam:3')).toEqual(restorableTransform(transform({ positionX: 10 })));
    expect(obs.filters.size).toBe(0);
  });

  it('restores the facecam and rejects when the effect throws', async () => {
    await expect(
      runner.run(
        effect(async (context) => {
          await context.setTransform(mainTarget(context), { rotation: 45 });
          throw new Error('mid-animation');
        })
      )
    ).rejects.toThrow('mid-animation');

    expect(obs.lastWrite('main-live:7')).toEqual(restorableTransform(transform()));
  });

  it('plays effects one at a time, each starting from the restored transform', async () => {
    const order: string[] = [];
    const slow = effect(async (context) => {
      order.push('slow:start');
      await context.sleep(20);
      order.push('slow:end');
    });
    const fast = effect(() => {
      order.push('fast');
      return Promise.resolve();
    });

    await Promise.all([runner.run(slow), runner.run(fast)]);

    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  it("doesn't let one effect's failure stop the next", async () => {
    const failing = runner.run(effect(() => Promise.reject(new Error('boom'))));
    const next = vi.fn(() => Promise.resolve());

    await expect(failing).rejects.toThrow('boom');
    await runner.run(effect(next));

    expect(next).toHaveBeenCalled();
  });

  it('refuses to play without OBS or without a facecam, so the reward is refunded', async () => {
    obs.status = IntegrationStatus.DISCONNECTED;
    await expect(runner.run(effect(() => Promise.resolve()))).rejects.toThrow(
      'OBS is not connected'
    );

    obs.status = IntegrationStatus.CONNECTED;
    obs.items.set('main-live', []);
    obs.items.set('vert-cam', []);
    await expect(runner.run(effect(() => Promise.resolve()))).rejects.toThrow(
      'No "Facecam" source in the current scene'
    );
  });

  it('cuts the running effect short on stop, restores it, and refuses queued ones', async () => {
    const long = runner.run(
      effect(async (context) => {
        await context.setTransform(mainTarget(context), { rotation: 180 });
        await context.sleep(60_000);
      })
    );
    const queued = runner.run(effect(() => Promise.resolve()));
    await vi.waitFor(() => expect(obs.writes.length).toBeGreaterThan(0));

    await runner.stop();

    await expect(long).resolves.toBeUndefined();
    await expect(queued).rejects.toThrow('Facecam effects are stopped');
    expect(obs.lastWrite('main-live:7')).toEqual(restorableTransform(transform()));
  });

  it('reports a restore OBS refuses to the streamer, without rejecting or retrying it', async () => {
    obs.setSceneItemTransform.mockRejectedValue(new Error('no such item'));

    await runner.run(effect(() => Promise.resolve()));

    expect(logger.error).toHaveBeenCalledWith(
      'Could not put "Facecam" back after an effect; check its position and filters in OBS.',
      expect.any(Error)
    );
    expect(reported).toEqual([
      {
        service: 'Facecam effects',
        message: expect.stringMatching(/put "Facecam" back.*check.*OBS.*no such item/),
      },
    ]);

    obs.setSceneItemTransform.mockClear();
    await eventBus.emit('integration.status', { name: 'obs', status: obs.status });
    expect(obs.setSceneItemTransform).not.toHaveBeenCalled();
  });

  describe('when OBS drops during an effect', () => {
    const droppingEffect = effect(async (context) => {
      await context.addFilter('tint', 'color_filter_v2', {});
      await context.setTransform(mainTarget(context), { positionX: 500 });
      obsDrops();
      await context.setTransform(mainTarget(context), { positionX: 600 });
    });

    it('rejects, so the reward is refunded, and tells nobody yet', async () => {
      await expect(runner.run(droppingEffect)).rejects.toThrow('OBS is not connected');

      expect(reported).toEqual([]);
    });

    it('puts the facecam and filters back when OBS returns', async () => {
      await runner.run(droppingEffect).catch(() => undefined);
      const original = restorableTransform(transform());
      expect(obs.lastWrite('main-live:7')).not.toEqual(original);
      expect(obs.filters).toEqual(new Set(['tint']));

      await obsReturns();

      expect(obs.lastWrite('main-live:7')).toEqual(original);
      expect(obs.lastWrite('vert-cam:3')).toEqual(
        restorableTransform(transform({ positionX: 10 }))
      );
      expect(obs.filters).toEqual(new Set());
      expect(reported).toEqual([]);
    });

    it('puts it back only once', async () => {
      await runner.run(droppingEffect).catch(() => undefined);
      await obsReturns();
      obs.writes.length = 0;

      await obsReturns();

      expect(obs.writes).toEqual([]);
    });

    it('keeps it owed if OBS drops again before it could be put back', async () => {
      await runner.run(droppingEffect).catch(() => undefined);
      obsDrops();
      await eventBus.emit('integration.status', {
        name: 'obs',
        status: IntegrationStatus.CONNECTED,
      });

      await obsReturns();

      expect(obs.lastWrite('main-live:7')).toEqual(restorableTransform(transform()));
    });

    it('finishes putting it back before an effect asked for meanwhile can start', async () => {
      await runner.run(droppingEffect).catch(() => undefined);
      const returned = obsReturns();
      let finishRestore = () => {};
      obs.setSceneItemTransform.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishRestore = resolve;
          })
      );
      const started = vi.fn(() => Promise.resolve());

      // Handed out after the status event: the restore is underway and waiting on OBS.
      const restoring = runner.run(effect(started));
      await vi.waitFor(() => expect(obs.setSceneItemTransform).toHaveBeenCalled());
      await new Promise((resolve) => setImmediate(resolve));
      expect(started).not.toHaveBeenCalled();

      obs.setSceneItemTransform.mockImplementation(accepted(obs));
      finishRestore();
      await returned;
      await restoring;
      expect(started).toHaveBeenCalledOnce();
    });

    it('tells the streamer if TuringMod stops before OBS returns', async () => {
      await runner.run(droppingEffect).catch(() => undefined);

      await runner.stop();

      expect(reported).toEqual([
        {
          service: 'Facecam effects',
          message: expect.stringContaining('stopped before OBS came back'),
        },
      ]);
    });
  });
});
