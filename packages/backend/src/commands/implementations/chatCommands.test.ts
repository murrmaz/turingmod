import 'reflect-metadata';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatModerator } from '../../chat/moderation/ChatModerator.js';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { COUNTERS, CounterRepository } from '../../database/repositories/CounterRepository.js';
import { SuggestionRepository } from '../../database/repositories/SuggestionRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import { InvalidStreamInfoError } from '../../platforms/errors.js';
import { fakeRequire } from '../../platforms/fakeRequire.js';
import type { StreamControlService } from '../../platforms/StreamControlService.js';
import { raidShoutoutMessage } from '../../raids/RaidShoutout.js';
import type { SoundLibrary } from '../../sounds/SoundLibrary.js';
import { Logger } from '../../utils/Logger.js';
import { commandContext } from '../testing.js';
import { AdCommand } from './AdCommand.js';
import { BonkCommand } from './BonkCommand.js';
import { ContentWarningCommand } from './ContentWarningCommand.js';
import { DelvodCommand } from './DelvodCommand.js';
import { DiedCommand } from './DiedCommand.js';
import { FollowageCommand } from './FollowageCommand.js';
import { QuietCommand } from './QuietCommand.js';
import { RdeathsCommand } from './RdeathsCommand.js';
import { parseRoll, RollCommand } from './RollCommand.js';
import { SgCommand } from './SgCommand.js';
import { SnoozeCommand } from './SnoozeCommand.js';
import { SoCommand } from './SoCommand.js';
import { SuggestionlistCommand } from './SuggestionlistCommand.js';
import { TagsCommand } from './TagsCommand.js';
import { streamerTime } from './TimeCommand.js';
import { VoiceCommand } from './VoiceCommand.js';

const logger = new Logger({ level: 'silent' });

/** A StreamControlService whose Twitch has only `apis`. */
const fakeStreamControl = (apis: Parameters<typeof fakeRequire>[1]) =>
  ({ require: fakeRequire(StreamingPlatform.TWITCH, apis) }) as unknown as StreamControlService;

describe('counter commands', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let counters: CounterRepository;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDatabase());
    counters = new CounterRepository(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('!died counts up from the stored count and !rdeaths resets it', async () => {
    counters.set(COUNTERS.deaths, 12);

    expect((await new DiedCommand(counters).execute(commandContext('!died'))).message).toBe(
      'Death count: 13'
    );
    await new RdeathsCommand(counters).execute(commandContext('!rdeaths'));
    expect(counters.get(COUNTERS.deaths)).toBe(0);
  });

  it('!voice counts voice cracks', async () => {
    const result = await new VoiceCommand(counters).execute(commandContext('!voice'));

    expect(result.message).toBe("Streamer's voice has cracked 1 times");
  });

  it('!sg records a suggestion and !suggestionlist shows the latest first', async () => {
    const suggestions = new SuggestionRepository(db);
    const sg = new SgCommand(suggestions);

    expect((await sg.execute(commandContext('!sg'))).success).toBe(false);
    await sg.execute(commandContext('!sg a quote command'));
    await sg.execute(commandContext('!sg more bonk'));

    const list = await new SuggestionlistCommand(suggestions).execute(
      commandContext('!suggestionlist')
    );
    expect(list.message).toBe('Latest suggestions for the bot: more bonk; a quote command');
  });
});

describe('!so', () => {
  it('posts the shoutout message even when the native shoutout fails', async () => {
    const shoutout = vi.fn(() => Promise.reject(new Error('not live')));
    const command = new SoCommand(fakeStreamControl({ shoutout: { shoutout } }), logger);

    const result = await command.execute(commandContext('!so @coolraider'));

    expect(shoutout).toHaveBeenCalledWith('coolraider');
    expect(result.message).toBe(raidShoutoutMessage('coolraider'));
  });

  it('asks for a channel', async () => {
    const command = new SoCommand({} as StreamControlService, logger);

    expect((await command.execute(commandContext('!so'))).message).toBe('Usage: !so <channel>');
  });

  it('finds the channel past extra spaces', async () => {
    const shoutout = vi.fn(() => Promise.resolve({ sent: true }));
    const command = new SoCommand(fakeStreamControl({ shoutout: { shoutout } }), logger);

    await command.execute(commandContext('!so  @coolraider'));

    expect(shoutout).toHaveBeenCalledWith('coolraider');
  });
});

describe('reading with a trailing space', () => {
  const moderator = { permissionLevel: PermissionLevel.MODERATOR };

  it('!tags shows the tags rather than clearing them', async () => {
    const setTags = vi.fn();
    const streamControl = {
      setTags,
      getStreamInfo: () => Promise.resolve({ tags: ['English'] }),
    } as unknown as StreamControlService;
    const command = new TagsCommand(streamControl, logger);

    const result = await command.execute(commandContext('!tags ', moderator));

    expect(setTags).not.toHaveBeenCalled();
    expect(result.message).toBe('Tags: [English]');
  });

  it('!cw shows the labels rather than clearing them', async () => {
    const setContentLabels = vi.fn();
    const contentLabels = {
      setContentLabels,
      getContentLabels: () => Promise.resolve(['ViolentGraphic']),
    };
    const command = new ContentWarningCommand(fakeStreamControl({ contentLabels }), logger);

    await command.execute(commandContext('!cw ', moderator));

    expect(setContentLabels).not.toHaveBeenCalled();
  });
});

describe('!cw', () => {
  const moderator = { permissionLevel: PermissionLevel.MODERATOR };

  it('clears the labels with none', async () => {
    const setContentLabels = vi.fn(() => Promise.resolve());
    const command = new ContentWarningCommand(
      fakeStreamControl({ contentLabels: { setContentLabels, getContentLabels: vi.fn() } }),
      logger
    );

    const result = await command.execute(commandContext('!cw None', moderator));

    expect(setContentLabels).toHaveBeenCalledWith([]);
    expect(result.message).toBe('Content labels cleared');
  });

  it('tells chat which label it does not know', async () => {
    const setContentLabels = () =>
      Promise.reject(new InvalidStreamInfoError('Unknown content label: Spiders'));
    const command = new ContentWarningCommand(
      fakeStreamControl({ contentLabels: { setContentLabels, getContentLabels: vi.fn() } }),
      logger
    );

    const result = await command.execute(commandContext('!cw Spiders', moderator));

    expect(result).toMatchObject({
      success: false,
      error: { code: 'INVALID_INPUT' },
      message: 'Unknown content label: Spiders',
    });
  });
});

describe('!quiet', () => {
  it('toggles quiet mode', async () => {
    let quiet = false;
    const moderator = {
      isQuietMode: () => quiet,
      setQuietMode: (enabled: boolean) => {
        quiet = enabled;
      },
    } as unknown as ChatModerator;
    const command = new QuietCommand(moderator);

    expect((await command.execute(commandContext('!quiet'))).message).toContain('enabled');
    expect(quiet).toBe(true);
    expect((await command.execute(commandContext('!quiet'))).message).toContain('disabled');
    expect(quiet).toBe(false);
  });
});

describe('!ad', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down to the next ad to the second, never as 0m', async () => {
    vi.useFakeTimers({ now: 0 });
    const getNextAdBreak = vi
      .fn()
      .mockResolvedValueOnce({ nextAdDate: new Date(45_000) })
      .mockResolvedValueOnce({ nextAdDate: new Date(4 * 60_000 + 50_000) });
    const command = new AdCommand(fakeStreamControl({ ads: { getNextAdBreak } }), logger);

    expect((await command.execute(commandContext('!ad'))).message).toBe('Next ad in 45s');
    expect((await command.execute(commandContext('!ad'))).message).toBe('Next ad in 4m 50s');
  });
});

describe('!snooze', () => {
  it('reports the snoozes left, or that there are none', async () => {
    const snoozeNextAd = vi
      .fn()
      .mockResolvedValueOnce({ snoozed: true, snoozesLeft: 2, nextAdDate: null })
      .mockResolvedValueOnce({ snoozed: false, snoozesLeft: 0, nextAdDate: null });
    const command = new SnoozeCommand(fakeStreamControl({ ads: { snoozeNextAd } }), logger);

    expect((await command.execute(commandContext('!snooze'))).message).toBe(
      '@Viewer: Ads snoozed! There are 2 left.'
    );
    expect((await command.execute(commandContext('!snooze'))).message).toBe(
      '@Viewer: There are no more snoozes left. Try again in a bit'
    );
  });
});

describe('!followage', () => {
  it('teases the streamer, reports non-followers, and times followers', async () => {
    const getFollowDate = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    const command = new FollowageCommand(
      fakeStreamControl({ followInfo: { getFollowDate } }),
      logger
    );

    expect(
      (
        await command.execute(
          commandContext('!followage', { permissionLevel: PermissionLevel.BROADCASTER })
        )
      ).message
    ).toContain("You're literally the streamer");
    expect((await command.execute(commandContext('!followage'))).message).toBe(
      '@Viewer: You are currently not following this channel'
    );
    expect((await command.execute(commandContext('!followage'))).message).toBe(
      '@Viewer has been following for 3 days'
    );
  });
});

describe('!delvod', () => {
  it('refuses to delete a real VOD from the simulator', async () => {
    const deleteLatestVod = vi.fn();
    const command = new DelvodCommand(fakeStreamControl({ vods: { deleteLatestVod } }), logger);

    const result = await command.execute(commandContext('!delvod', { isSimulation: true }));

    expect(result.success).toBe(false);
    expect(deleteLatestVod).not.toHaveBeenCalled();
  });

  it('deletes the latest broadcast', async () => {
    const deleteLatestVod = vi.fn(() =>
      Promise.resolve({ id: 'v1', title: 'Oops', url: 'u', createdAt: new Date(0) })
    );
    const command = new DelvodCommand(fakeStreamControl({ vods: { deleteLatestVod } }), logger);

    expect((await command.execute(commandContext('!delvod'))).message).toBe(
      'VOD successfully deleted'
    );
  });
});

describe('!roll', () => {
  it('parses dice notation', () => {
    expect(parseRoll('d20')).toEqual({ count: 1, sides: 20, minimum: 0 });
    expect(parseRoll('3d6r10')).toEqual({ count: 3, sides: 6, minimum: 10 });
    expect(parseRoll('3x6')).toBeNull();
  });

  it('rolls within range, raising a low total to the minimum', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const command = new RollCommand();

    expect((await command.execute(commandContext('!roll 2d6'))).message).toBe(
      '@Viewer: You rolled 2 d6 and got 2'
    );
    expect((await command.execute(commandContext('!roll 2d6r7'))).message).toBe(
      '@Viewer: You rolled 2 d6 and got 7'
    );
    expect((await command.execute(commandContext('!roll 2d6r13'))).success).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('!bonk', () => {
  it('sometimes bonks the bonker instead', async () => {
    const command = new BonkCommand({ tryPlay: vi.fn() } as unknown as SoundLibrary);

    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect((await command.execute(commandContext('!bonk @friend'))).message).toBe(
      'The bot got tired of doing whatever the meatbags want and bonked Viewer instead (Total: 1)'
    );
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect((await command.execute(commandContext('!bonk @friend'))).message).toBe(
      'Viewer bonked friend! (Total: 1)'
    );
    vi.restoreAllMocks();
  });
});

describe('!time', () => {
  it("tells the time in the streamer's zone", () => {
    expect(streamerTime(new Date('2026-01-15T18:05:00Z'))).toBe('12:05 PM CST');
    expect(streamerTime(new Date('2026-07-15T18:05:00Z'))).toBe('1:05 PM CDT');
  });
});
