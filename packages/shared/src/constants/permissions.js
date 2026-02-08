/**
 * Permission levels for command execution
 * Ordered from lowest to highest privilege
 */
export var PermissionLevel;
(function (PermissionLevel) {
    PermissionLevel["VIEWER"] = "viewer";
    PermissionLevel["SUBSCRIBER"] = "subscriber";
    PermissionLevel["VIP"] = "vip";
    PermissionLevel["MODERATOR"] = "moderator";
    PermissionLevel["BROADCASTER"] = "broadcaster";
})(PermissionLevel || (PermissionLevel = {}));
/**
 * Permission hierarchy mapping
 * Higher index = higher privilege
 */
export const PERMISSION_HIERARCHY = [
    PermissionLevel.VIEWER,
    PermissionLevel.SUBSCRIBER,
    PermissionLevel.VIP,
    PermissionLevel.MODERATOR,
    PermissionLevel.BROADCASTER,
];
/**
 * Check if a user has sufficient permission
 * @param userLevel - The user's permission level
 * @param requiredLevel - The required permission level
 * @returns true if user has sufficient permission
 */
export function hasPermission(userLevel, requiredLevel) {
    const userIndex = PERMISSION_HIERARCHY.indexOf(userLevel);
    const requiredIndex = PERMISSION_HIERARCHY.indexOf(requiredLevel);
    return userIndex >= requiredIndex;
}
//# sourceMappingURL=permissions.js.map