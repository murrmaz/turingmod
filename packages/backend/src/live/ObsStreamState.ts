import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { ObsIntegration } from '../integrations/implementations/obs/ObsIntegration.js';
import { Logger } from '../utils/Logger.js';

/** obs-websocket output states, from the `obs.stream.stateChanged` payload. */
const OBS_OUTPUT_STARTED = 'OBS_WEBSOCKET_OUTPUT_STARTED';
const OBS_OUTPUT_STOPPED = 'OBS_WEBSOCKET_OUTPUT_STOPPED';

/**
 * Knows whether OBS is sending the stream out, and publishes `stream.output.changed` when that
 * changes. It knows nothing about platforms: each one that needs a go-live signal (YouTube chat,
 * whose chat only exists per broadcast) reacts to the event in its own service.
 *
 * OBS only reports transitions, so one that happened while TuringMod wasn't connected to OBS is
 * found by asking OBS whenever it connects. That covers TuringMod starting mid-stream and OBS
 * reconnecting to it mid-stream. Reconnecting to the ingest server (OBS's own RECONNECTING /
 * RECONNECTED states) isn't a change: the stream is still meant to be going out.
 *
 * While OBS is disconnected the last state it reported stands, so a platform that comes up then
 * still learns that a stream was going out.
 */
@injectable()
@singleton()
export class ObsStreamState implements IService {
  private subscriptions = new Subscriptions();
  private streaming = false;
  private logger: Logger;

  constructor(
    private eventBus: EventBus,
    private obs: ObsIntegration,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ObsStreamState' });
  }

  start(): void {
    this.subscriptions.add(
      this.eventBus.on('obs.stream.stateChanged', ({ outputState }) => {
        if (outputState === OBS_OUTPUT_STARTED || outputState === OBS_OUTPUT_STOPPED) {
          return this.update(outputState === OBS_OUTPUT_STARTED);
        }
      }),
      this.eventBus.on('integration.status', ({ name, status }) => {
        if (name === this.obs.name && status === IntegrationStatus.CONNECTED) {
          return this.refresh();
        }
      })
    );
  }

  stop(): void {
    this.subscriptions.clear();
  }

  /** Whether OBS was streaming when last heard from. */
  isStreaming(): boolean {
    return this.streaming;
  }

  /** Ask OBS directly, for a transition missed while it wasn't connected. */
  private async refresh(): Promise<void> {
    try {
      await this.update(await this.obs.isStreaming());
    } catch (error) {
      this.logger.warn('Could not ask OBS whether it is streaming', { error: messageOf(error) });
    }
  }

  private async update(streaming: boolean): Promise<void> {
    if (this.streaming === streaming) {
      return;
    }
    this.streaming = streaming;
    this.logger.info(streaming ? 'OBS started streaming' : 'OBS stopped streaming');
    await this.eventBus.emit('stream.output.changed', { streaming });
  }
}
