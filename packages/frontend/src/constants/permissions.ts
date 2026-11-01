import { PermissionLevel } from '@turingmod/shared';

/** How each permission level reads in the console. */
export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  [PermissionLevel.VIEWER]: 'Viewer',
  [PermissionLevel.SUBSCRIBER]: 'Subscriber',
  [PermissionLevel.VIP]: 'VIP',
  [PermissionLevel.MODERATOR]: 'Moderator',
  [PermissionLevel.BROADCASTER]: 'Broadcaster',
};
