import { IntegrationStatus } from '@turingmod/shared';
import OBSWebSocket from 'obs-websocket-js';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';

interface ObsConfig {
  url: string | undefined;
  password: string | undefined;
}

/**
 * Scene item transform properties as returned by OBS WebSocket v5.
 * obs-websocket-js types this as JsonObject; we provide the actual shape.
 */
export interface SceneItemTransform {
  positionX: number;
  positionY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  alignment: number;
  boundsType: string;
  boundsAlignment: number;
  boundsWidth: number;
  boundsHeight: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
}

/**
 * Stream status information from OBS.
 */
export interface ObsStreamStatus {
  outputActive: boolean;
  outputReconnecting: boolean;
  outputTimecode: string;
  outputDuration: number;
  outputCongestion: number;
  outputBytes: number;
  outputSkippedFrames: number;
  outputTotalFrames: number;
}

/** A canvas (OBS 31+/obs-websocket 5.7+), e.g. the main canvas or an Aitum Vertical canvas. */
export interface ObsCanvas {
  canvasUuid: string;
  canvasName: string;
}

/** A scene, identified by UUID so it is unambiguous across canvases. */
export interface ObsScene {
  sceneName: string;
  sceneUuid: string;
}

/** A source placed in a scene, with its current visibility. */
export interface ObsSceneItem {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
}

const DEFAULT_OBS_URL = 'ws://127.0.0.1:4455';

/** obs-websocket RequestStatus.UnknownRequestType: the connected OBS predates the request. */
const OBS_UNKNOWN_REQUEST_TYPE = 204;

@injectable()
@singleton()
export class ObsIntegration extends BaseIntegration {
  readonly name = 'obs';
  readonly version = '1.0.0';

  private obs: OBSWebSocket = new OBSWebSocket();
  private config: ObsConfig = { url: undefined, password: undefined };

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    super(logger, { component: 'ObsIntegration' });
  }

  initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      url: (config.url as string | undefined) ?? DEFAULT_OBS_URL,
      password: config.password as string | undefined,
    };

    this.logger.debug('OBS integration initialized', { url: this.config.url });
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.logger.debug('Starting OBS integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      await this.obs.connect(this.config.url, this.config.password);

      this.subscribeToObsEvents();

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.debug('OBS integration started successfully');
    } catch (error) {
      this.logger.error('Failed to connect to OBS', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Failed to connect to OBS'
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.debug('Stopping OBS integration');

    this.obs.removeAllListeners();
    await this.obs.disconnect();

    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.debug('OBS integration stopped');
  }

  /**
   * Get the underlying OBSWebSocket client for direct use by commands.
   * Use `client.call(requestType, requestData)` to send any OBS request.
   */
  getClient(): OBSWebSocket {
    return this.obs;
  }

  // ── Scene Item Resolution ──────────────────────────────────────────────

  /**
   * Get a scene item's numeric ID by source name.
   * @param sceneName Scene to search in. Defaults to current program scene.
   */
  async getSceneItemId(sourceName: string, sceneName?: string): Promise<number> {
    this.ensureConnected();
    const scene = await this.resolveSceneName(sceneName);
    const { sceneItemId } = await this.obs.call('GetSceneItemId', {
      sceneName: scene,
      sourceName,
    });
    return sceneItemId;
  }

  // ── Transform Primitives ──────────────────────────────────────────────

  /**
   * Get the full transform of a scene item.
   * @param sceneName Scene the item is in. Defaults to current program scene.
   */
  async getSceneItemTransform(
    sceneItemId: number,
    sceneName?: string
  ): Promise<SceneItemTransform> {
    this.ensureConnected();
    const scene = await this.resolveSceneName(sceneName);
    const { sceneItemTransform } = await this.obs.call('GetSceneItemTransform', {
      sceneName: scene,
      sceneItemId,
    });
    return sceneItemTransform as unknown as SceneItemTransform;
  }

  /**
   * Set (merge) transform properties on a scene item.
   * Only provided fields are changed; others are untouched.
   * @param sceneName Scene the item is in. Defaults to current program scene.
   */
  async setSceneItemTransform(
    sceneItemId: number,
    transform: Partial<SceneItemTransform>,
    sceneName?: string
  ): Promise<void> {
    this.ensureConnected();
    const scene = await this.resolveSceneName(sceneName);
    await this.obs.call('SetSceneItemTransform', {
      sceneName: scene,
      sceneItemId,
      sceneItemTransform: transform as Record<string, number | string>,
    });
  }

  // ── Visibility Primitives ─────────────────────────────────────────────

  /**
   * Get whether a scene item is currently visible.
   * @param sceneName Scene the item is in. Defaults to current program scene.
   */
  async getSceneItemEnabled(sceneItemId: number, sceneName?: string): Promise<boolean> {
    this.ensureConnected();
    const scene = await this.resolveSceneName(sceneName);
    const { sceneItemEnabled } = await this.obs.call('GetSceneItemEnabled', {
      sceneName: scene,
      sceneItemId,
    });
    return sceneItemEnabled;
  }

  /**
   * Show or hide a scene item.
   * @param sceneName Scene the item is in. Defaults to current program scene.
   */
  async setSceneItemEnabled(
    sceneItemId: number,
    enabled: boolean,
    sceneName?: string
  ): Promise<void> {
    this.ensureConnected();
    const scene = await this.resolveSceneName(sceneName);
    await this.obs.call('SetSceneItemEnabled', {
      sceneName: scene,
      sceneItemId,
      sceneItemEnabled: enabled,
    });
  }

  // ── Canvases, Scenes and Items by UUID ───────────────────────────────
  //
  // Scene names are only unique within a canvas, so anything that walks more than one canvas
  // addresses scenes by UUID. These don't default to the program scene: a non-main canvas has
  // no program scene of its own as far as obs-websocket is concerned.

  /**
   * List the canvases OBS knows about. Empty when the connected OBS predates canvas support,
   * in which case the scene methods below operate on the main canvas.
   */
  async getCanvases(): Promise<ObsCanvas[]> {
    this.ensureConnected();
    try {
      const { canvases } = await this.obs.call('GetCanvasList');
      return canvases.flatMap((canvas) =>
        typeof canvas.canvasUuid === 'string'
          ? [{ canvasUuid: canvas.canvasUuid, canvasName: String(canvas.canvasName ?? '') }]
          : []
      );
    } catch (error: unknown) {
      if (this.isObsError(error) && error.code === OBS_UNKNOWN_REQUEST_TYPE) {
        return [];
      }
      throw error;
    }
  }

  /**
   * List the scenes on a canvas.
   * @param canvasUuid Canvas to list. Defaults to the main canvas.
   */
  async getScenes(canvasUuid?: string): Promise<ObsScene[]> {
    this.ensureConnected();
    const { scenes } = await this.obs.call(
      'GetSceneList',
      canvasUuid === undefined ? {} : { canvasUuid }
    );
    return scenes.flatMap((scene) =>
      typeof scene.sceneUuid === 'string' && typeof scene.sceneName === 'string'
        ? [{ sceneName: scene.sceneName, sceneUuid: scene.sceneUuid }]
        : []
    );
  }

  /** List the items placed directly in a scene (not inside nested groups). */
  async getSceneItems(sceneUuid: string): Promise<ObsSceneItem[]> {
    this.ensureConnected();
    const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneUuid });
    return sceneItems.flatMap((item) =>
      typeof item.sceneItemId === 'number' && typeof item.sourceName === 'string'
        ? [
            {
              sceneItemId: item.sceneItemId,
              sourceName: item.sourceName,
              sceneItemEnabled: item.sceneItemEnabled === true,
            },
          ]
        : []
    );
  }

  /** Show or hide a scene item in a scene identified by UUID. */
  async setSceneItemEnabledInScene(
    sceneUuid: string,
    sceneItemId: number,
    enabled: boolean
  ): Promise<void> {
    this.ensureConnected();
    await this.obs.call('SetSceneItemEnabled', {
      sceneUuid,
      sceneItemId,
      sceneItemEnabled: enabled,
    });
  }

  // ── Audio Inputs ──────────────────────────────────────────────────────

  /** Whether an audio input is muted. */
  async getInputMuted(inputName: string): Promise<boolean> {
    this.ensureConnected();
    const { inputMuted } = await this.obs.call('GetInputMute', { inputName });
    return inputMuted;
  }

  /** Mute or unmute an audio input. Absolute, unlike OBS's ToggleInputMute. */
  async setInputMuted(inputName: string, muted: boolean): Promise<void> {
    this.ensureConnected();
    await this.obs.call('SetInputMute', { inputName, inputMuted: muted });
  }

  // ── Scene Switching ───────────────────────────────────────────────────

  /**
   * Get the name of the current program (live) scene.
   */
  async getCurrentScene(): Promise<string> {
    this.ensureConnected();
    const { sceneName } = await this.obs.call('GetCurrentProgramScene');
    return sceneName;
  }

  /**
   * Switch the program (live) scene.
   */
  async setCurrentScene(sceneName: string): Promise<void> {
    this.ensureConnected();
    await this.obs.call('SetCurrentProgramScene', { sceneName });
  }

  // ── Filter Management ─────────────────────────────────────────────────

  /**
   * Add a filter to a source. No-op if a filter with the same name already exists.
   */
  async addFilter(
    sourceName: string,
    filterName: string,
    filterKind: string,
    filterSettings?: Record<string, unknown>
  ): Promise<void> {
    this.ensureConnected();
    try {
      const request: {
        sourceName: string;
        filterName: string;
        filterKind: string;
        filterSettings?: Record<string, never>;
      } = { sourceName, filterName, filterKind };
      if (filterSettings) {
        request.filterSettings = filterSettings as Record<string, never>;
      }
      await this.obs.call('CreateSourceFilter', request);
    } catch (error: unknown) {
      // OBS error code 601 = resource already exists
      if (this.isObsError(error) && error.code === 601) {
        return;
      }
      throw error;
    }
  }

  /**
   * Remove a filter from a source. No-op if the filter does not exist.
   */
  async removeFilter(sourceName: string, filterName: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.obs.call('RemoveSourceFilter', { sourceName, filterName });
    } catch (error: unknown) {
      // OBS error code 600 = resource not found
      if (this.isObsError(error) && error.code === 600) {
        return;
      }
      throw error;
    }
  }

  /**
   * Enable or disable a filter on a source.
   */
  async setFilterEnabled(sourceName: string, filterName: string, enabled: boolean): Promise<void> {
    this.ensureConnected();
    await this.obs.call('SetSourceFilterEnabled', {
      sourceName,
      filterName,
      filterEnabled: enabled,
    });
  }

  /**
   * Update settings on an existing filter.
   * @param overlay If true (default), merge on top of existing settings. If false, reset then apply.
   */
  async setFilterSettings(
    sourceName: string,
    filterName: string,
    settings: Record<string, unknown>,
    overlay = true
  ): Promise<void> {
    this.ensureConnected();
    await this.obs.call('SetSourceFilterSettings', {
      sourceName,
      filterName,
      filterSettings: settings as Record<string, never>,
      overlay,
    });
  }

  // ── Stream Status ─────────────────────────────────────────────────────

  /**
   * Get stream status including uptime.
   */
  async getStreamStatus(): Promise<ObsStreamStatus> {
    this.ensureConnected();
    return await this.obs.call('GetStreamStatus');
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  private ensureConnected(): void {
    if (this.status !== IntegrationStatus.CONNECTED) {
      throw new Error('OBS is not connected');
    }
  }

  /**
   * Resolve a scene name, defaulting to the current program scene.
   * For animation loops, resolve once and pass explicitly to avoid repeated calls.
   */
  private async resolveSceneName(sceneName?: string): Promise<string> {
    if (sceneName) return sceneName;
    const { sceneName: current } = await this.obs.call('GetCurrentProgramScene');
    return current;
  }

  private isObsError(error: unknown): error is { code: number; message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'number'
    );
  }

  private subscribeToObsEvents(): void {
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      this.logger.debug('Scene changed', { sceneName: data.sceneName });
      this.eventBus.emit('obs.scene.changed', data);
    });

    this.obs.on('StreamStateChanged', (data) => {
      this.logger.debug('Stream state changed', { outputState: data.outputState });
      this.eventBus.emit('obs.stream.stateChanged', data);
    });

    this.obs.on('RecordStateChanged', (data) => {
      this.logger.debug('Record state changed', { outputState: data.outputState });
      this.eventBus.emit('obs.record.stateChanged', data);
    });

    this.obs.on('SceneItemEnableStateChanged', (data) => {
      this.logger.debug('Scene item state changed', data);
      this.eventBus.emit('obs.sceneItem.stateChanged', data);
    });

    this.obs.on('ConnectionClosed', () => {
      this.logger.warn('OBS connection closed unexpectedly');
      this.setStatus(IntegrationStatus.DISCONNECTED);
    });

    this.obs.on('ConnectionError', (error) => {
      this.logger.error('OBS connection error', error);
      this.setStatus(
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Connection error'
      );
    });
  }
}
