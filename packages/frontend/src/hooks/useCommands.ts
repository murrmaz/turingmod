import type { CommandResultPayload, SimulatedUser } from '@turingmod/shared';
import { MessageType, type StreamingPlatform } from '@turingmod/shared';
import { useCallback } from 'react';
import { useWebSocketContext } from '@/context/WebSocketContext';

/** Running a command through the simulator, as if `simulatedUser` had typed it on `platform`. */
export function useCommands() {
  const { request } = useWebSocketContext();

  const simulateCommand = useCallback(
    (
      commandText: string,
      simulatedUser: SimulatedUser,
      platform: StreamingPlatform
    ): Promise<CommandResultPayload> =>
      request(MessageType.COMMAND_SIMULATE, { commandText, simulatedUser, platform }),
    [request]
  );

  return { simulateCommand };
}
