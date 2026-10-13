import type { PermissionLevel } from '../constants/permissions.js';

/**
 * Simulated user for command testing
 */
export interface SimulatedUser {
  /** Display username for simulation */
  username: string;

  /** Simulated permission level */
  permissionLevel: PermissionLevel;

  /** Platform-specific user ID (optional for simulations) */
  userId?: string;
}
