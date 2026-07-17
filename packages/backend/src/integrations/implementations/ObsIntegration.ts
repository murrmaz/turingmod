import { IntegrationStatus } from '@turingmod/shared';
import OBSWebSocket from 'obs-websocket-js';
import type { EventBus } from '../../core/EventBus.js';
import type { Logger } from '../../utils/Logger.js';
import { BaseIntegration } from '../BaseIntegration.js';

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

const DEFAULT_OBS_URL = 'ws://127.0.0.1:4455';

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

    this.logger.info('OBS integration initialized', { url: this.config.url });
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.logger.info('Starting OBS integration');
    this.setStatus(IntegrationStatus.CONNECTING);

    try {
      await this.obs.connect(this.config.url, this.config.password);

      this.subscribeToObsEvents();

      this.setStatus(IntegrationStatus.CONNECTED);
      this.logger.info('OBS integration started successfully');
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
    this.logger.info('Stopping OBS integration');

    this.obs.removeAllListeners();
    await this.obs.disconnect();

    this.setStatus(IntegrationStatus.DISCONNECTED);
    this.logger.info('OBS integration stopped');
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
