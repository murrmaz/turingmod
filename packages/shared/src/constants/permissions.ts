/**
 * Permission levels for command execution
 * Ordered from lowest to highest privilege
 */
export enum PermissionLevel {
  VIEWER = 'viewer',
  SUBSCRIBER = 'subscriber',
  VIP = 'vip',
  MODERATOR = 'moderator',
  BROADCASTER = 'broadcaster',
}

/**
 * Permission hierarchy mapping
 * Higher index = higher privilege
 */
export const PERMISSION_HIERARCHY: readonly PermissionLevel[] = [
  PermissionLevel.VIEWER,
  PermissionLevel.SUBSCRIBER,
  PermissionLevel.VIP,
  PermissionLevel.MODERATOR,
  PermissionLevel.BROADCASTER,
] as const;

/**
 * Check if a user has sufficient permission
 * @param userLevel - The user's permission level
 * @param requiredLevel - The required permission level
 * @returns true if user has sufficient permission
 */
export function hasPermission(userLevel: PermissionLevel, requiredLevel: PermissionLevel): boolean {
  const userIndex = PERMISSION_HIERARCHY.indexOf(userLevel);
  const requiredIndex = PERMISSION_HIERARCHY.indexOf(requiredLevel);
  return userIndex >= requiredIndex;
}
