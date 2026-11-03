import 'reflect-metadata';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LurkTracker } from '../../chat/lurk/LurkTracker.js';
import { EventBus } from '../../core/EventBus.js';
import { InvalidStreamInfoError } from '../../platforms/errors.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { fakeRequire } from '../../platforms/testing.js';
import { Logger } from '../../utils/Logger.js';
import { commandContext, errorCodeOf, runCommand } from '../testing.js';
import { AccountageCommand } from './AccountageCommand.js';
import { GameCommand } from './GameCommand.js';
import { LeaveCommand } from './LeaveCommand.js';
import { LurkCommand } from './LurkCommand.js';
import { ScheduleCommand } from './ScheduleCommand.js';
import { UnlurkCommand } from './UnlurkCommand.js';
import { UptimeCommand } from './UptimeCommand.js';
import { WhoCommand } from './WhoCommand.js';

const moderator = { permissionLevel: PermissionLevel.MODERATOR };
const control = (fields: object) => fields as unknown as StreamControlService;

afterEach(() => {
  vi.useRealTimers();
});

describe('!game', () => {
  it('shows the current game to anyone', async () => {
    const getStreamInfo = vi.fn(() => Promise.resolve({ title: 't', game: 'Celeste' }));
    const command = new GameCommand(control({ getStreamInfo }));

    const result = await command.execute(commandContext('!game'));

    expect(result.message).toBe('Current Game: Celeste');
    expect(getStreamInfo).toHaveBeenCalledWith(StreamingPlatform.TWITCH);
  });

  it('says when no game is set', async () => {
    const command = new GameCommand(
      control({ getStreamInfo: () => Promise.resolve({ title: 't' }) })
    );

    expect((await command.execute(commandContext('!game'))).message).toBe('No game/category set');
  });

  it('refuses a viewer changing it, without touching the platform', async () => {
    const setGame = vi.fn();
    const command = new GameCommand(control({ setGame }));

    const result = await command.execute(commandContext('!game Celeste'));

    expect(errorCodeOf(result)).toBe('ACTION_NOT_PERMITTED');
    expect(setGame).not.toHaveBeenCalled();
  });

  it('changes it for a moderator, keeping every word of the name', async () => {
    const setGame = vi.fn(() =>
      Promise.resolve({ updated: [StreamingPlatform.TWITCH], failures: [], skipped: [] })
    );
    const command = new GameCommand(control({ setGame }));

    const result = await command.execute(commandContext('!game Hollow Knight', moderator));

    expect(setGame).toHaveBeenCalledWith('Hollow Knight');
    expect(result.message).toBe('Game changed to Hollow Knight on Twitch');
  });

  it('repeats a game Twitch has no such thing as, but no other failure', async () => {
    const getStreamInfo = vi
      .fn()
      .mockRejectedValueOnce(new InvalidStreamInfoError('Game not found: Nope'))
      .mockRejectedValueOnce(new Error('Helix timed out'));
    const command = new GameCommand(control({ getStreamInfo }));

    const invalid = await runCommand(command, commandContext('!game'));
    const outage = await runCommand(command, commandContext('!game'));

    expect(invalid.message).toBe('Game not found: Nope');
    expect(outage.message).toBe('Failed to get/set stream game');
  });
});

describe('!uptime', () => {
  it('says how long the stream has been live', async () => {
    const command = new UptimeCommand(control({ getUptime: () => Promise.resolve(90 * 60_000) }));

    expect((await command.execute(commandContext('!uptime'))).message).toBe(
      'Stream has been live for 1h 30m'
    );
  });

  it('says when the stream is offline', async () => {
    const command = new UptimeCommand(control({ getUptime: () => Promise.resolve(null) }));

    expect((await command.execute(commandContext('!uptime'))).message).toBe('Stream is offline');
  });
});

describe('!schedule', () => {
  const schedule = (getSchedule: () => Promise<unknown>) =>
    new ScheduleCommand(
      control({
        require: fakeRequire(StreamingPlatform.TWITCH, { schedule: { getSchedule } as never }),
      })
    );

  it('names the next stream, with what is known about it', async () => {
    const command = schedule(() =>
      Promise.resolve([
        { startDate: new Date('2026-11-05T20:00:00Z'), title: 'Speedruns', category: 'Celeste' },
        { startDate: new Date('2026-11-06T20:00:00Z') },
      ])
    );

    const { message } = await command.execute(commandContext('!schedule'));

    expect(message).toMatch(/^Next stream: .* - Speedruns \(Celeste\)$/);
  });

  it('leaves out a title and category it does not have', async () => {
    const command = schedule(() =>
      Promise.resolve([{ startDate: new Date('2026-11-05T20:00:00Z') }])
    );

    const { message } = await command.execute(commandContext('!schedule'));

    expect(message).not.toMatch(/ - |\(/);
  });

  it('says when nothing is scheduled', async () => {
    const command = schedule(() => Promise.resolve([]));

    expect((await command.execute(commandContext('!schedule'))).message).toBe(
      'No upcoming scheduled streams'
    );
  });
});

describe('!who', () => {
  const who = (description: string | null) =>
    new WhoCommand(
      control({
        require: fakeRequire(StreamingPlatform.TWITCH, {
          broadcasterAbout: { getBroadcasterAbout: () => Promise.resolve(description) },
        }),
      })
    );

  it('shows the bio', async () => {
    expect((await who('Streams games').execute(commandContext('!who'))).message).toBe(
      'About: Streams games'
    );
  });

  it('says when there is none', async () => {
    expect((await who(null).execute(commandContext('!who'))).message).toBe('No description set');
  });
});

describe('!accountage', () => {
  const accountage = (getAccountCreatedAt: (id: string) => Promise<Date | null>) =>
    new AccountageCommand(
      control({
        require: fakeRequire(StreamingPlatform.TWITCH, { accountAge: { getAccountCreatedAt } }),
      })
    );

  it('looks up whoever asked', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T00:00:00Z') });
    const lookup = vi.fn(() => Promise.resolve(new Date('2026-11-01T00:00:00Z')));

    const { message } = await accountage(lookup).execute(
      commandContext('!accountage', { platformUserId: 'u1', username: 'Someone' })
    );

    expect(lookup).toHaveBeenCalledWith('u1');
    expect(message).toMatch(/^@Someone, your account is .* old$/);
  });

  it('says when the account cannot be found', async () => {
    const { message } = await accountage(() => Promise.resolve(null)).execute(
      commandContext('!accountage', { username: 'Someone' })
    );

    expect(message).toBe("@Someone, I couldn't find your account");
  });
});

describe('!lurk, !unlurk and !leave', () => {
  const setup = () => {
    const logger = new Logger({ level: 'silent' });
    const tracker = new LurkTracker(new EventBus(logger), control({}), logger);
    return {
      lurk: new LurkCommand(tracker),
      unlurk: new UnlurkCommand(tracker),
      leave: new LeaveCommand(tracker),
    };
  };
  const viewer = { username: 'Someone', platformUserId: 'u1' };

  it('lurks once, and ends the lurk once', async () => {
    const { lurk, unlurk } = setup();

    await lurk.execute(commandContext('!lurk dinner', viewer));
    const again = await lurk.execute(commandContext('!lurk', viewer));
    const back = await unlurk.execute(commandContext('!unlurk', viewer));
    const notLurking = await unlurk.execute(commandContext('!unlurk', viewer));

    expect(again.message).toBe("You're already lurking @Someone");
    expect(back.message).toMatch(/^Welcome back @Someone! .*"dinner"$/);
    expect(notLurking.message).toContain('You needed to be lurking');
  });

  it('keeps the same id apart on different platforms', async () => {
    const { lurk, unlurk } = setup();
    await lurk.execute(commandContext('!lurk', viewer));

    const elsewhere = await unlurk.execute({
      ...commandContext('!unlurk', viewer),
      platform: StreamingPlatform.YOUTUBE,
    });

    expect(elsewhere.message).toContain('You needed to be lurking');
  });

  it('ends a lurk on !leave too', async () => {
    const { lurk, unlurk, leave } = setup();
    await lurk.execute(commandContext('!lurk', viewer));

    const bye = await leave.execute(commandContext('!leave', viewer));
    const after = await unlurk.execute(commandContext('!unlurk', viewer));

    expect(bye.message).toBe('Goodbye for now @Someone! See you later!');
    expect(after.message).toContain('You needed to be lurking');
  });
});
