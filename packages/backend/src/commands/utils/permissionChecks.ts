import type { CommandResult } from '@turingmod/shared';
import { type PermissionLevel, hasPermission } from '@turingmod/shared';

/**
 * Gate a write-path sub-action within a command that is otherwise open to a
 * lower permission level (e.g. a viewer-readable command whose "set" branch
 * is moderator-only). Uses the same PERMISSION_HIERARCHY-aware `hasPermission`
 * check as CommandExecutor's top-level gate, instead of comparing
 * PermissionLevel values directly (they're string enum members, so `<`/`>`
 * compares lexicographically and does not reflect privilege order).
 *
 * @returns a rejection CommandResult if the user doesn't meet `required`, or null to proceed
 */
export function checkPermission(
  userLevel: PermissionLevel,
  required: PermissionLevel,
  action: string
): CommandResult | null {
  if (hasPermission(userLevel, required)) {
    return null;
  }

  const label = required.charAt(0).toUpperCase() + required.slice(1);

  return {
    success: false,
    message: `Only ${required}s can ${action}`,
    error: {
      code: 'INSUFFICIENT_PERMISSIONS',
      message: `${label} required`,
    },
  };
}
