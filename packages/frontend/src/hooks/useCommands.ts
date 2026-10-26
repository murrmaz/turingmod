import type { SimulatedUser, StreamingPlatform } from '@turingmod/shared';
import { useCallback } from 'react';
import { type RouterOutputs, useTrpc } from '@/context/TrpcContext';

/** Running a command through the simulator, as if `simulatedUser` had typed it on `platform`. */
export function useCommands() {
  const trpc = useTrpc();

  const simulateCommand = useCallback(
    (
      commandText: string,
      simulatedUser: SimulatedUser,
      platform: StreamingPlatform
    ): Promise<RouterOutputs['commands']['simulate']> =>
      trpc.commands.simulate.mutate({ commandText, simulatedUser, platform }),
    [trpc]
  );

  return { simulateCommand };
}
