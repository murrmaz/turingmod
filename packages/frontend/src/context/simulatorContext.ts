import type { PermissionLevel } from '@turingmod/shared';
import { createContext, useContext } from 'react';

/** What to open the simulator on. */
export interface SimulatorRequest {
  /** A command's name, without `!`. */
  command?: string;
  permissionLevel?: PermissionLevel;
}

/**
 * Opening the command simulator from anywhere (a page, the ⌘K palette). SimulatorProvider
 * (`components/simulator.tsx`) provides it and renders the sheet.
 */
export interface Simulator {
  open: (request?: SimulatorRequest) => void;
}

export const SimulatorContext = createContext<Simulator | null>(null);

/** The command simulator; see Simulator. */
export function useSimulator(): Simulator {
  const context = useContext(SimulatorContext);
  if (!context) {
    throw new Error('useSimulator must be used within SimulatorProvider');
  }
  return context;
}
