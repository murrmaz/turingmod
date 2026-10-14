import { IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { type IService, Subscriptions } from '../core/ServiceLifecycle.js';
import { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { ObsStreamState } from './ObsStreamState.js';

/**
 * Connects YouTube chat while OBS is streaming, and disconnects it when OBS stops.
 *
 * YouTube chat belongs to one broadcast and YouTube can't tell a localhost server that one
 * started, so something has to say when to look for it. Streaming might be going to other
 * platforms only; YouTube chat looks for a live broadcast for a bounded time and goes back to
 * idle if there isn't one, so a stream elsewhere costs nothing.
 *
 * YouTube chat coming up while OBS is already streaming (TuringMod restarting mid-stream, or chat
 * restarting after its login recovered) connects too, since no transition will arrive for it.
 */
@injectable()
@singleton()
export class YouTubeChatAutoConnect implements IService {
  private subscriptions = new Subscriptions();

  constructor(
    private eventBus: EventBus,
    private chat: YouTubeChatIntegration,
    private obsStream: ObsStreamState
  ) {}

  start(): void {
    this.subscriptions.add(
      this.eventBus.on('stream.output.changed', ({ streaming }) => {
        // Not running means YouTube isn't set up, or is waiting on its login; it connects on its
        // own status change below once it's up.
        if (this.chat.getStatus() !== IntegrationStatus.CONNECTED) {
          return;
        }
        if (streaming) {
          this.chat.connectChat('OBS');
        } else {
          this.chat.disconnectChat('OBS');
        }
      }),
      this.eventBus.on('integration.status', ({ name, status }) => {
        if (
          name === this.chat.name &&
          status === IntegrationStatus.CONNECTED &&
          this.obsStream.isStreaming()
        ) {
          this.chat.connectChat('OBS');
        }
      })
    );
  }

  stop(): void {
    this.subscriptions.clear();
  }
}
