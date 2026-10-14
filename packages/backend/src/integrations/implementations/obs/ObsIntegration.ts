import { IntegrationStatus, messageOf } from '@turingmod/shared';
import OBSWebSocket, { type OBSResponseTypes } from 'obs-websocket-js';
import { injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';

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

/** A source placed in a scene (or a group), with its current visibility. */
export interface ObsSceneItem {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
  /**
   * For an item that is a group, the group's UUID, which addresses the items inside it the way
   * a scene's UUID addresses a scene's. Undefined for anything else.
   */
  groupUuid: string | undefined;
}

const DEFAULT_OBS_URL = 'ws://127.0.0.1:4455';

const ObsConfigSchema = z.strictObject({
  /** obs-websocket's address. Omitted = OBS's default on this machine. */
  url: z.url({ protocol: /^wss?$/ }).default(DEFAULT_OBS_URL),
  /** obs-websocket's server password. Omitted = authentication is off in OBS. */
  password: z.string().min(1).exactOptional(),
});

type ObsConfig = z.infer<typeof ObsConfigSchema>;

/** obs-websocket RequestStatus.UnknownRequestType: the connected OBS predates the request. */
const OBS_UNKNOWN_REQUEST_TYPE = 204;

@injectable()
@singleton()
export class ObsIntegration extends BaseIntegration {
  readonly name = 'obs';

  private obs: OBSWebSocket = new OBSWebSocket();
  private config: ObsConfig = ObsConfigSchema.parse({});

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    super(logger, { component: 'ObsIntegration' });
  }

  override initialize(stored: unknown): Promise<void> {
    this.config = this.parseConfig(ObsConfigSchema, stored);

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
      this.setStatus(IntegrationStatus.ERROR, messageOf(error, 'Failed to connect to OBS'));
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

  // ── Canvases, Scenes and Items ────────────────────────────────────────
  //
  // Scene names are only unique within a canvas, so anything that walks more than one canvas
  // addresses scenes by UUID. Nothing here defaults to the program scene: a non-main canvas has
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

  /**
   * List the items placed directly in a scene. A group shows up as one item; what's inside it
   * comes from getGroupItems().
   */
  async getSceneItems(sceneUuid: string): Promise<ObsSceneItem[]> {
    this.ensureConnected();
    const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneUuid });
    return toSceneItems(sceneItems);
  }

  /**
   * List the items inside a group. obs-websocket treats a group as a scene for scene item
   * requests, so they are addressed by `groupUuid` wherever a scene UUID is asked for.
   */
  async getGroupItems(groupUuid: string): Promise<ObsSceneItem[]> {
    this.ensureConnected();
    const { sceneItems } = await this.obs.call('GetGroupSceneItemList', { sceneUuid: groupUuid });
    return toSceneItems(sceneItems);
  }

  /** Show or hide a scene item. */
  async setSceneItemEnabled(
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

  /** Get the full transform of a scene item. */
  async getSceneItemTransform(sceneUuid: string, sceneItemId: number): Promise<SceneItemTransform> {
    this.ensureConnected();
    const { sceneItemTransform } = await this.obs.call('GetSceneItemTransform', {
      sceneUuid,
      sceneItemId,
    });
    return sceneItemTransform as unknown as SceneItemTransform;
  }

  /** Set (merge) transform properties on a scene item. */
  async setSceneItemTransform(
    sceneUuid: string,
    sceneItemId: number,
    transform: Partial<SceneItemTransform>
  ): Promise<void> {
    this.ensureConnected();
    await this.obs.call('SetSceneItemTransform', {
      sceneUuid,
      sceneItemId,
      sceneItemTransform: transform as Record<string, number | string>,
    });
  }

  /** The main canvas's base (canvas) resolution. */
  async getCanvasSize(): Promise<{ width: number; height: number }> {
    this.ensureConnected();
    const { baseWidth, baseHeight } = await this.obs.call('GetVideoSettings');
    return { width: baseWidth, height: baseHeight };
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

  // ── Program Scene ─────────────────────────────────────────────────────

  /** The UUID of the current program (live) scene, which is on the main canvas. */
  async getCurrentSceneUuid(): Promise<string> {
    this.ensureConnected();
    const { sceneUuid } = await this.obs.call('GetCurrentProgramScene');
    return sceneUuid;
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

  // ── Private Helpers ───────────────────────────────────────────────────

  private ensureConnected(): void {
    if (this.status !== IntegrationStatus.CONNECTED) {
      throw new Error('OBS is not connected');
    }
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
      this.setStatus(IntegrationStatus.ERROR, messageOf(error, 'Connection error'));
    });
  }
}

/** Scene items from obs-websocket's untyped list, dropping any without an id or source name. */
function toSceneItems(
  sceneItems: OBSResponseTypes['GetSceneItemList']['sceneItems']
): ObsSceneItem[] {
  return sceneItems.flatMap((item) =>
    typeof item.sceneItemId === 'number' && typeof item.sourceName === 'string'
      ? [
          {
            sceneItemId: item.sceneItemId,
            sourceName: item.sourceName,
            sceneItemEnabled: item.sceneItemEnabled === true,
            groupUuid:
              item.isGroup === true && typeof item.sourceUuid === 'string'
                ? item.sourceUuid
                : undefined,
          },
        ]
      : []
  );
}
