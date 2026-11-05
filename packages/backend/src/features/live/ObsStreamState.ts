import { IntegrationStatus } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../core/EventBus.js';
import { failureReporter, type ReportFailure } from '../../core/failures.js';
import { type IService, onConnected, Subscriptions } from '../../core/ServiceLifecycle.js';
import { ObsIntegration } from '../../integrations/implementations/obs/ObsIntegration.js';
import { Logger } from '../../utils/Logger.js';

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
@singleton()
export class ObsStreamState implements IService {
  private subscriptions = new Subscriptions();
  private streaming = false;
  private logger: Logger;
  private report: ReportFailure;

  constructor(
    private eventBus: EventBus,
    private obs: ObsIntegration,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ObsStreamState' });
    this.report = failureReporter(eventBus, this.logger, 'OBS stream state');
  }

  start(): void {
    this.subscriptions.add(
      this.eventBus.on('obs.stream.stateChanged', ({ outputState }) => {
        if (outputState === OBS_OUTPUT_STARTED || outputState === OBS_OUTPUT_STOPPED) {
          return this.update(outputState === OBS_OUTPUT_STARTED);
        }
      }),
      onConnected(this.eventBus, this.obs, () => this.refresh())
    );
  }

  stop(): void {
    this.subscriptions.clear();
  }

  /** Whether OBS was streaming when last heard from. */
  isStreaming(): boolean {
    return this.streaming;
  }

  /**
   * Ask OBS directly, for a transition missed while it wasn't connected. If OBS has gone again by
   * the time this fails there's nothing to tell: it's asked again when it reconnects.
   */
  private async refresh(): Promise<void> {
    try {
      await this.update(await this.obs.isStreaming());
    } catch (error) {
      if (this.obs.getStatus() === IntegrationStatus.CONNECTED) {
        this.report(
          'Could not ask OBS whether it is streaming, so YouTube chat may not connect by itself. ' +
            'If you are live, connect it from the console.',
          error
        );
      } else {
        this.logger.debug('OBS went away before saying whether it is streaming', { error });
      }
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
