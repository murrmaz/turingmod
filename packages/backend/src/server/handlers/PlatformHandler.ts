import type { EmptyPayload, IWebSocketMessage, PlatformLiveStatePayload } from '@turingmod/shared';
import { createPlatformLiveStateMessage } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { PlatformLiveStatus } from '../../live/PlatformLiveStatus.js';

/**
 * Platform message handler
 * Answers the console's request for every platform's live state. Changes are pushed as they
 * happen, so this is only for a console that just loaded or reconnected.
 */
@singleton()
export class PlatformHandler {
  constructor(private liveStatus: PlatformLiveStatus) {}

  handleGetLiveState(
    message: IWebSocketMessage<EmptyPayload>
  ): Promise<IWebSocketMessage<PlatformLiveStatePayload>> {
    return Promise.resolve(createPlatformLiveStateMessage(this.liveStatus.getStates(), message.id));
  }
}
