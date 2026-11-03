import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';

/** obs-websocket-js's error: a close code (or -1) and a reason. */
class FakeObsError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

/** The client as ObsIntegration sees it: connect, disconnect, and events. */
class FakeOBSWebSocket extends EventEmitter {
  static instance: FakeOBSWebSocket;
  /** What each connect() does, in order; a connect past the end succeeds. */
  outcomes: (FakeObsError | 'ok')[] = [];
  connects = 0;
  open = false;
  /** Answers each request: what the test hands back from OBS. */
  call = vi.fn<(request: string, data?: unknown) => Promise<unknown>>();

  constructor() {
    super();
    FakeOBSWebSocket.instance = this;
  }

  connect(): Promise<void> {
    this.connects++;
    const outcome = this.outcomes.shift() ?? 'ok';
    if (outcome === 'ok') {
      this.open = true;
      return Promise.resolve();
    }
    this.emit('ConnectionClosed', outcome);
    return Promise.reject(outcome);
  }

  disconnect(): Promise<void> {
    if (this.open) {
      this.open = false;
      this.emit('ConnectionClosed', new FakeObsError(1000, ''));
    }
    return Promise.resolve();
  }

  /** OBS going away on its own: quit, crashed, or restarted. */
  drop(code = 1006): void {
    this.open = false;
    this.emit('ConnectionClosed', new FakeObsError(code, 'gone'));
  }
}

vi.mock('obs-websocket-js', () => ({
  default: FakeOBSWebSocket,
  // biome-ignore lint/style/useNamingConvention: mirrors the exported class name.
  OBSWebSocketError: FakeObsError,
}));

const { ObsIntegration } = await import('./ObsIntegration.js');

const unreachable = () => new FakeObsError(-1, 'connect ECONNREFUSED 127.0.0.1:4455');

describe('ObsIntegration', () => {
  let eventBus: EventBus;
  let integration: InstanceType<typeof ObsIntegration>;
  let socket: FakeOBSWebSocket;

  beforeEach(async () => {
    vi.useFakeTimers();
    const logger = new Logger({ level: 'silent' });
    eventBus = new EventBus(logger);
    integration = new ObsIntegration(eventBus, logger);
    socket = FakeOBSWebSocket.instance;
    await integration.initialize({});
  });

  afterEach(async () => {
    await integration.stop();
    vi.useRealTimers();
  });

  it("reports the address it connects to for the setup dialog, and OBS's default without one", async () => {
    expect(integration.getAddress()).toBe('ws://127.0.0.1:4455');

    await integration.initialize({ url: 'ws://192.168.1.20:4455', password: 'hunter2' });

    expect(integration.getAddress()).toBe('ws://192.168.1.20:4455');
  });

  it('forwards each OBS event once, however often it has reconnected', async () => {
    const changed = vi.fn();
    eventBus.on('obs.scene.changed', changed);
    await integration.start();
    socket.drop();
    await integration.start(); // Start from the console, as before reconnecting existed
    socket.drop();
    await vi.advanceTimersByTimeAsync(2_000); // and a reconnect

    socket.emit('CurrentProgramSceneChanged', { sceneName: 'Gameplay', sceneUuid: 'g' });

    expect(changed).toHaveBeenCalledOnce();
  });

  it('keeps trying while OBS is unreachable, backing off, and connects once it is up', async () => {
    socket.outcomes = [unreachable(), unreachable(), unreachable()];

    await integration.start(); // resolves: retrying isn't a failure
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);
    expect(integration.getErrorMessage()).toMatch(/Can't reach OBS.*retrying in 2s/);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.connects).toBe(2);
    expect(integration.getErrorMessage()).toMatch(/retrying in 4s/);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(socket.connects).toBe(3);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(socket.connects).toBe(4);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
    expect(integration.getErrorMessage()).toBeUndefined();
  });

  it('waits no more than 30s between attempts', async () => {
    socket.outcomes = Array.from({ length: 8 }, unreachable);

    await integration.start();
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000);

    expect(integration.getErrorMessage()).toMatch(/retrying in 30s/);
  });

  it('reconnects when OBS goes away on its own', async () => {
    await integration.start();

    socket.drop();
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTING);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(integration.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('stops retrying when stopped', async () => {
    socket.outcomes = [unreachable()];
    await integration.start();

    await integration.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.connects).toBe(1);
    expect(integration.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });

  it('does not treat its own disconnect as OBS going away', async () => {
    await integration.start();

    await integration.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.connects).toBe(1);
  });

  it('reports a wrong password as an error, without retrying', async () => {
    await integration.initialize({ password: 'hunter2' });
    socket.outcomes = [new FakeObsError(4009, 'Authentication failed.')];

    await expect(integration.start()).rejects.toThrow(/rejected the password/);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(socket.connects).toBe(1);
  });

  it('says a password is needed when OBS asks for one and none is set', async () => {
    socket.outcomes = [new FakeObsError(4009, 'Authentication failed.')];

    await expect(integration.start()).rejects.toThrow(/requires a password/);
  });

  it('stops retrying when OBS closes the session for good', async () => {
    await integration.start();

    socket.drop(4011);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(integration.getStatus()).toBe(IntegrationStatus.ERROR);
    expect(socket.connects).toBe(1);
  });

  describe('getSceneItemTransform', () => {
    const transform = {
      positionX: 10,
      positionY: 20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 640,
      height: 360,
      sourceWidth: 1280,
      sourceHeight: 720,
      alignment: 5,
      boundsType: 'OBS_BOUNDS_NONE',
      boundsAlignment: 0,
      boundsWidth: 0,
      boundsHeight: 0,
      cropBottom: 0,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
    };

    it('returns the transform OBS reports, without fields it has added since', async () => {
      await integration.start();
      socket.call.mockResolvedValue({ sceneItemTransform: { ...transform, cropToBounds: false } });

      expect(await integration.getSceneItemTransform('scene', 3)).toEqual(transform);
    });

    it('refuses a transform that is not the shape effects read', async () => {
      await integration.start();
      socket.call.mockResolvedValue({ sceneItemTransform: { ...transform, scaleX: null } });

      await expect(integration.getSceneItemTransform('scene', 3)).rejects.toThrow(
        /Unexpected scene item transform from OBS[\s\S]*scaleX/
      );
    });
  });

  describe('a request OBS never answers', () => {
    it('fails when the connection drops, once OBS already reads as gone', async () => {
      socket.call.mockReturnValue(new Promise(() => {}));
      await integration.start();

      const request = integration.getCurrentSceneUuid();
      const seen = request.catch(() => integration.getStatus());
      socket.drop();

      await expect(request).rejects.toThrow('The connection to OBS closed before it answered');
      expect(await seen).toBe(IntegrationStatus.CONNECTING);
    });

    it('fails when the integration is stopped', async () => {
      socket.call.mockReturnValue(new Promise(() => {}));
      await integration.start();

      const request = integration.getCurrentSceneUuid();
      await integration.stop();

      await expect(request).rejects.toThrow('The connection to OBS closed before it answered');
    });
  });

  describe('requests', () => {
    beforeEach(async () => {
      await integration.start();
    });

    it('lists canvases, dropping any without an id', async () => {
      socket.call.mockResolvedValue({
        canvases: [
          { canvasUuid: 'c1', canvasName: 'Main' },
          { canvasUuid: 'c2' },
          { canvasName: 'x' },
        ],
      });

      expect(await integration.getCanvases()).toEqual([
        { canvasUuid: 'c1', canvasName: 'Main' },
        { canvasUuid: 'c2', canvasName: '' },
      ]);
    });

    it('has no canvases on an OBS that predates them, and rethrows anything else', async () => {
      socket.call.mockRejectedValueOnce(new FakeObsError(204, 'unknown request'));
      expect(await integration.getCanvases()).toEqual([]);

      socket.call.mockRejectedValueOnce(new FakeObsError(500, 'broken'));
      await expect(integration.getCanvases()).rejects.toThrow('broken');
    });

    it('lists scenes, on the canvas asked for, dropping any without an id or name', async () => {
      socket.call.mockResolvedValue({
        scenes: [{ sceneUuid: 's1', sceneName: 'Live' }, { sceneUuid: 's2' }, 'odd'],
      });

      expect(await integration.getScenes('c1')).toEqual([{ sceneUuid: 's1', sceneName: 'Live' }]);
      expect(socket.call).toHaveBeenLastCalledWith('GetSceneList', { canvasUuid: 'c1' });
    });

    it('lists scene items, reading null as OBS sends it for what is not a group', async () => {
      socket.call.mockResolvedValue({
        sceneItems: [
          {
            sceneItemId: 1,
            sourceName: 'Cam',
            sceneItemEnabled: true,
            isGroup: null,
            sourceUuid: 'a',
          },
          {
            sceneItemId: 2,
            sourceName: 'Group',
            sceneItemEnabled: false,
            isGroup: true,
            sourceUuid: 'g',
          },
          { sourceName: 'no id' },
        ],
      });

      expect(await integration.getSceneItems('s1')).toEqual([
        { sceneItemId: 1, sourceName: 'Cam', sceneItemEnabled: true, groupUuid: undefined },
        { sceneItemId: 2, sourceName: 'Group', sceneItemEnabled: false, groupUuid: 'g' },
      ]);
    });

    it('reads a group through its own list', async () => {
      socket.call.mockResolvedValue({ sceneItems: [] });

      await integration.getGroupItems('g');

      expect(socket.call).toHaveBeenLastCalledWith('GetGroupSceneItemList', { sceneUuid: 'g' });
    });

    it('refuses a scene item transform that is not the shape effects animate', async () => {
      socket.call.mockResolvedValue({ sceneItemTransform: { positionX: 'left' } });

      await expect(integration.getSceneItemTransform('s1', 1)).rejects.toThrow(
        'Unexpected scene item transform from OBS'
      );
    });

    it('sets a mute absolutely, never as a toggle', async () => {
      socket.call.mockResolvedValue({});

      await integration.setInputMuted('Mic', true);

      expect(socket.call).toHaveBeenLastCalledWith('SetInputMute', {
        inputName: 'Mic',
        inputMuted: true,
      });
    });

    it('adds a filter that already exists without complaint, and rethrows anything else', async () => {
      socket.call.mockRejectedValueOnce(new FakeObsError(601, 'exists'));
      await expect(
        integration.addFilter('Cam', 'tint', 'color_filter_v2')
      ).resolves.toBeUndefined();

      socket.call.mockRejectedValueOnce(new FakeObsError(600, 'no such source'));
      await expect(integration.addFilter('Cam', 'tint', 'color_filter_v2')).rejects.toThrow(
        'no such source'
      );
    });

    it('removes a filter already gone without complaint, and rethrows anything else', async () => {
      socket.call.mockRejectedValueOnce(new FakeObsError(600, 'not found'));
      await expect(integration.removeFilter('Cam', 'tint')).resolves.toBeUndefined();

      socket.call.mockRejectedValueOnce(new FakeObsError(601, 'odd'));
      await expect(integration.removeFilter('Cam', 'tint')).rejects.toThrow('odd');
    });

    it('treats an error that is not OBS answering as a failure, whatever its code', async () => {
      socket.call.mockRejectedValueOnce(Object.assign(new Error('socket'), { code: 600 }));

      await expect(integration.removeFilter('Cam', 'tint')).rejects.toThrow('socket');
    });

    it('refuses every request while not connected', async () => {
      await integration.stop();

      await expect(integration.getCurrentSceneUuid()).rejects.toThrow('OBS is not connected');
      await expect(integration.getScenes()).rejects.toThrow('OBS is not connected');
      await expect(integration.isStreaming()).rejects.toThrow('OBS is not connected');
    });
  });
});
