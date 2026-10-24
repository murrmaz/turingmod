import type { CommandResultPayload, SimulatedUser } from '@turingmod/shared';
import { MessageType, StreamingPlatform } from '@turingmod/shared';
import { useCallback } from 'react';
import { useAppState } from '../context/AppStateContext';
import { useWebSocketContext } from '../context/WebSocketContext';

/**
 * Hook to interact with commands
 */
export function useCommands() {
  const { request } = useWebSocketContext();
  const { commands, refreshCommands } = useAppState();

  /**
   * Simulate a command execution
   */
  const simulateCommand = useCallback(
    async (
      commandText: string,
      simulatedUser: SimulatedUser,
      platform: StreamingPlatform = StreamingPlatform.TWITCH
    ): Promise<CommandResultPayload> => {
      try {
        return await request(MessageType.COMMAND_SIMULATE, {
          commandText,
          simulatedUser,
          platform,
        });
      } catch (error) {
        console.error('[useCommands] Failed to simulate command', error);
        throw error;
      }
    },
    [request]
  );

  /**
   * Get command by name
   */
  const getCommand = useCallback(
    (name: string) => {
      return commands.find((c) => c.name === name);
    },
    [commands]
  );

  return {
    commands,
    simulateCommand,
    getCommand,
    refreshCommands,
  };
}
