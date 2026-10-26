import 'reflect-metadata';
import { PermissionLevel } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { permissionFromBadges } from './TwitchEventSubIntegration.js';

describe('permissionFromBadges', () => {
  it('treats a lead moderator as a moderator', () => {
    expect(permissionFromBadges(['lead_moderator', 'subscriber'])).toBe(PermissionLevel.MODERATOR);
  });

  it('treats a founder as a subscriber', () => {
    expect(permissionFromBadges(['founder'])).toBe(PermissionLevel.SUBSCRIBER);
  });

  it('takes the highest role among the badges', () => {
    expect(permissionFromBadges(['subscriber', 'vip'])).toBe(PermissionLevel.VIP);
    expect(permissionFromBadges(['glhf-pledge'])).toBe(PermissionLevel.VIEWER);
  });
});
