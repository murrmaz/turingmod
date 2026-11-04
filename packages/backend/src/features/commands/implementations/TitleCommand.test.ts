import 'reflect-metadata';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MirrorResult,
  StreamControlService,
} from '../../../platforms/StreamControlService.js';
import { commandContext, errorCodeOf } from '../testing.js';
import TitleCommand from './TitleCommand.js';

const setTitle = vi.fn<(title: string) => Promise<MirrorResult>>();

const streamControl = { setTitle } as unknown as StreamControlService;

const contextFor = (...words: string[]) =>
  commandContext(['!title', ...words].join(' '), {
    platformUserId: '1',
    username: 'mod',
    permissionLevel: PermissionLevel.MODERATOR,
  });

describe('TitleCommand', () => {
  let command: TitleCommand;

  beforeEach(() => {
    setTitle.mockReset();
    command = new TitleCommand(streamControl);
  });

  it('is moderator-only, so the executor gates it with no inner permission check', () => {
    expect(command.permissions).toEqual([PermissionLevel.MODERATOR]);
  });

  it('answers bare !title with usage instead of reading the current title', async () => {
    const result = await command.execute(contextFor());

    expect(setTitle).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toBe('Usage: !title <new title>');
    expect(errorCodeOf(result)).toBe('INVALID_INPUT');
  });

  it('rejects a whitespace-only title without calling the platform', async () => {
    const result = await command.execute(contextFor('   '));

    expect(setTitle).not.toHaveBeenCalled();
    expect(errorCodeOf(result)).toBe('INVALID_INPUT');
  });

  it('mirrors a multi-word title and names the platforms it reached', async () => {
    setTitle.mockResolvedValue({
      updated: [StreamingPlatform.TWITCH, StreamingPlatform.YOUTUBE],
      skipped: [],
      failures: [],
    });

    const result = await command.execute(contextFor('Playing', 'some', 'game'));

    expect(setTitle).toHaveBeenCalledWith('Playing some game');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Title updated on Twitch, YouTube: Playing some game');
  });

  it('reports a divergent mirror as a success naming only the platforms that took it', async () => {
    setTitle.mockResolvedValue({
      updated: [StreamingPlatform.TWITCH],
      skipped: [],
      failures: [{ platform: StreamingPlatform.YOUTUBE, error: 'No active YouTube broadcast' }],
    });

    const result = await command.execute(contextFor('New', 'title'));

    expect(result.success).toBe(true);
    expect(result.message).toBe('Title updated on Twitch: New title');
  });

  it('fails when no platform took the change', async () => {
    setTitle.mockResolvedValue({
      updated: [],
      skipped: [],
      failures: [{ platform: StreamingPlatform.TWITCH, error: 'Helix rejected the update' }],
    });

    const result = await command.execute(contextFor('New', 'title'));

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to update title on Twitch');
  });
});
