import type { PermissionLevel } from '../constants/permissions.js';
/**
 * Represents a user in the system
 */
export interface User {
    /** Unique identifier */
    id: string;
    /** Platform the user belongs to (e.g., 'twitch', 'discord') */
    platform: string;
    /** Platform-specific user ID */
    platformUserId: string;
    /** Display username */
    username: string;
    /** User's permission level */
    permissionLevel: PermissionLevel;
    /** Timestamp when user was created */
    createdAt: number;
    /** Timestamp when user was last updated */
    updatedAt: number;
}
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
//# sourceMappingURL=user.d.ts.map