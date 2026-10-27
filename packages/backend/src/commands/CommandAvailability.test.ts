import 'reflect-metadata';
import { PlatformCapability, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IStreamPlatform } from '../platforms/interfaces/IStreamPlatform.js';
import { PlatformRegistry } from '../platforms/PlatformRegistry.js';
import { Logger } from '../utils/Logger.js';
import { CommandAvailability } from './CommandAvailability.js';
import { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

const command = (name: string, requiredCapabilities: PlatformCapability[]) =>
  ({ name, requiredCapabilities }) as unknown as ICommand;

/** A façade that can set a title everywhere, and has ads only where `ads` is given. */
const platform = (name: StreamingPlatform, ads?: object) =>
  ({
    platform: name,
    declaredCapabilities: new Set([PlatformCapability.SET_TITLE]),
    ...(ads ? { ads } : {}),
  }) as unknown as IStreamPlatform;

describe('CommandAvailability', () => {
  let availability: CommandAvailability;

  beforeEach(() => {
    const commands = new CommandRegistry(new Logger({ level: 'silent' }));
    commands.register(command('roll', []));
    commands.register(command('title', [PlatformCapability.SET_TITLE]));
    commands.register(command('ad', [PlatformCapability.ADS]));
    const platforms = new PlatformRegistry();
    platforms.register(platform(StreamingPlatform.TWITCH, {}));
    platforms.register(platform(StreamingPlatform.YOUTUBE));
    availability = new CommandAvailability(commands, platforms);
  });

  it('finds a command on a platform that has everything it needs', () => {
    expect(availability.find('ad', StreamingPlatform.TWITCH)?.name).toBe('ad');
  });

  it('hides a command on a platform missing something it needs, as if it were unknown', () => {
    expect(availability.find('ad', StreamingPlatform.YOUTUBE)).toBeUndefined();
    expect(availability.find('nope', StreamingPlatform.TWITCH)).toBeUndefined();
  });

  it('offers a command that needs nothing everywhere', () => {
    expect(availability.platformsFor(command('roll', []))).toEqual([
      StreamingPlatform.TWITCH,
      StreamingPlatform.YOUTUBE,
    ]);
  });

  it("lists a platform's commands", () => {
    expect(availability.listFor(StreamingPlatform.YOUTUBE).map(({ name }) => name)).toEqual([
      'roll',
      'title',
    ]);
  });

  it('offers nothing that needs a capability on a platform that is not registered', () => {
    const commands = new CommandRegistry(new Logger({ level: 'silent' }));
    commands.register(command('title', [PlatformCapability.SET_TITLE]));

    expect(
      new CommandAvailability(commands, new PlatformRegistry()).find(
        'title',
        StreamingPlatform.TWITCH
      )
    ).toBeUndefined();
  });
});
