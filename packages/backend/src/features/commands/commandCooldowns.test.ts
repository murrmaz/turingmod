import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { hasPermission, PermissionLevel } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import type { InjectableClass } from '../../utils/importImplementations.js';
import type { ICommand } from './interfaces/ICommand.js';

const IMPLEMENTATIONS = new URL('./implementations/', import.meta.url);

/** Stands in for any dependency: a command's fields don't use them, only `execute()` does. */
const anyDependency: unknown = new Proxy(() => {}, {
  get: () => anyDependency,
  apply: () => anyDependency,
});

function allCommands(): Promise<ICommand[]> {
  const files = readdirSync(IMPLEMENTATIONS).filter((file) => file.endsWith('Command.ts'));
  return Promise.all(
    files.map(async (file) => {
      const module = await import(new URL(file, IMPLEMENTATIONS).href);
      const commandClass = module.default as InjectableClass<ICommand>;
      return new commandClass(...Array(commandClass.length).fill(anyDependency));
    })
  );
}

describe('command cooldowns', () => {
  it('gives every command a viewer can use to call out a cooldown', async () => {
    // `failureMessage` is what marks a command as calling something outside itself. Moderators are
    // exempt from cooldowns, so one that only they can run doesn't need one.
    const callsOutForViewers = (await allCommands()).filter(
      ({ failureMessage, permissions }) =>
        failureMessage !== undefined &&
        permissions.some((level) => !hasPermission(level, PermissionLevel.MODERATOR))
    );

    expect(callsOutForViewers.map(({ name }) => name)).toContain('game'); // still finds them
    expect(
      callsOutForViewers.filter(({ cooldown }) => cooldown <= 0).map(({ name }) => name)
    ).toEqual([]);
  });
});
