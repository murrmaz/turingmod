/**
 * Permission levels for command execution
 * Ordered from lowest to highest privilege
 */
export declare enum PermissionLevel {
    VIEWER = "viewer",
    SUBSCRIBER = "subscriber",
    VIP = "vip",
    MODERATOR = "moderator",
    BROADCASTER = "broadcaster"
}
/**
 * Permission hierarchy mapping
 * Higher index = higher privilege
 */
export declare const PERMISSION_HIERARCHY: readonly PermissionLevel[];
/**
 * Check if a user has sufficient permission
 * @param userLevel - The user's permission level
 * @param requiredLevel - The required permission level
 * @returns true if user has sufficient permission
 */
export declare function hasPermission(userLevel: PermissionLevel, requiredLevel: PermissionLevel): boolean;
//# sourceMappingURL=permissions.d.ts.map