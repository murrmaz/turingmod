import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionLevel, Platform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { initialSchema } from '../migrations/001_initial_schema.js';
import { UserRepository } from './UserRepository.js';

describe('UserRepository', () => {
  let dir: string;
  let db: DatabaseManager;
  let repo: UserRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-user-repo-test-'));
    db = new DatabaseManager(join(dir, 'test.sqlite'), new Logger({ level: 'silent' }));
    await db.initialize();
    initialSchema.up(db);
    repo = new UserRepository(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a user and returns it with generated id/timestamps', async () => {
    const user = await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '123',
      username: 'alice',
      permissionLevel: PermissionLevel.VIEWER,
    });

    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.createdAt).toBe(user.updatedAt);
  });

  it('finds a user by id', async () => {
    const created = await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '123',
      username: 'alice',
      permissionLevel: PermissionLevel.VIEWER,
    });

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('returns null when a user id is not found', async () => {
    expect(await repo.findById('does-not-exist')).toBeNull();
  });

  it('finds a user by platform and platform user id', async () => {
    const created = await repo.create({
      platform: Platform.YOUTUBE,
      platformUserId: 'yt-1',
      username: 'bob',
      permissionLevel: PermissionLevel.MODERATOR,
    });

    const found = await repo.findByPlatformUserId(Platform.YOUTUBE, 'yt-1');
    expect(found).toEqual(created);
    expect(await repo.findByPlatformUserId(Platform.TWITCH, 'yt-1')).toBeNull();
  });

  it('finds all users with no filter', async () => {
    await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '1',
      username: 'a',
      permissionLevel: PermissionLevel.VIEWER,
    });
    await repo.create({
      platform: Platform.YOUTUBE,
      platformUserId: '2',
      username: 'b',
      permissionLevel: PermissionLevel.MODERATOR,
    });

    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('filters users by platform and permission level', async () => {
    await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '1',
      username: 'a',
      permissionLevel: PermissionLevel.VIEWER,
    });
    await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '2',
      username: 'b',
      permissionLevel: PermissionLevel.MODERATOR,
    });
    await repo.create({
      platform: Platform.YOUTUBE,
      platformUserId: '3',
      username: 'c',
      permissionLevel: PermissionLevel.MODERATOR,
    });

    const twitchUsers = await repo.findAll({ platform: Platform.TWITCH });
    expect(twitchUsers.map((u) => u.username).sort()).toEqual(['a', 'b']);

    const moderators = await repo.findAll({ permissionLevel: PermissionLevel.MODERATOR });
    expect(moderators.map((u) => u.username).sort()).toEqual(['b', 'c']);

    const twitchMods = await repo.findAll({
      platform: Platform.TWITCH,
      permissionLevel: PermissionLevel.MODERATOR,
    });
    expect(twitchMods.map((u) => u.username)).toEqual(['b']);
  });

  it('updates username and permission level, bumping updatedAt', async () => {
    const created = await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '1',
      username: 'a',
      permissionLevel: PermissionLevel.VIEWER,
    });

    const updated = await repo.update(created.id, {
      username: 'a-renamed',
      permissionLevel: PermissionLevel.VIP,
    });

    expect(updated.username).toBe('a-renamed');
    expect(updated.permissionLevel).toBe(PermissionLevel.VIP);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('update with no fields leaves the row unchanged', async () => {
    const created = await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '1',
      username: 'a',
      permissionLevel: PermissionLevel.VIEWER,
    });

    const updated = await repo.update(created.id, {});
    expect(updated).toEqual(created);
  });

  it('throws when updating a user that does not exist', async () => {
    await expect(repo.update('missing', { username: 'x' })).rejects.toThrow('User not found');
  });

  it('deletes a user and reports whether a row was removed', async () => {
    const created = await repo.create({
      platform: Platform.TWITCH,
      platformUserId: '1',
      username: 'a',
      permissionLevel: PermissionLevel.VIEWER,
    });

    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.delete(created.id)).toBe(false);
  });
});
