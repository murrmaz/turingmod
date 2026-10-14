import { z } from 'zod';
import { PermissionLevel } from '../constants/permissions.js';

/**
 * Simulated user for command testing
 */
export const SimulatedUserSchema = z.strictObject({
  /** Display username for simulation */
  username: z.string().min(1),

  /** Simulated permission level */
  permissionLevel: z.enum(PermissionLevel),

  /** Platform-specific user ID (optional for simulations) */
  userId: z.string().min(1).exactOptional(),
});

export type SimulatedUser = z.infer<typeof SimulatedUserSchema>;
