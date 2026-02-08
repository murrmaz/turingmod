import type { CommandResultPayload, PermissionLevel } from '@turingmod/shared';
import { MessageType } from '@turingmod/shared';
import { useCallback } from 'react';
import { useAppState } from '../context/AppStateContext';
import { useWebSocketContext } from '../context/WebSocketContext';

/**
 * Simulated user for command testing
 */
export interface SimulatedUser {
  username: string;
  permissionLevel: PermissionLevel;
  userId?: string;
}

/**
 * Hook to interact with commands
 */
export function useCommands() {
  const { sendAndWaitForResponse } = useWebSocketContext();
  const { commands, refreshCommands } = useAppState();

  /**
   * Simulate a command execution
   */
  const simulateCommand = useCallback(
    async (
      commandText: string,
      simulatedUser: SimulatedUser,
      platform = 'twitch'
    ): Promise<CommandResultPayload> => {
      try {
        const response = await sendAndWaitForResponse<CommandResultPayload>({
          id: crypto.randomUUID(),
          type: MessageType.COMMAND_SIMULATE,
          timestamp: Date.now(),
          payload: {
            commandText,
            simulatedUser: {
              username: simulatedUser.username,
              permissionLevel: simulatedUser.permissionLevel,
              userId: simulatedUser.userId,
            },
            platform,
          },
        });

        return response.payload;
      } catch (error) {
        console.error('[useCommands] Failed to simulate command', error);
        throw error;
      }
    },
    [sendAndWaitForResponse]
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
